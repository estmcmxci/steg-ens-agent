/**
 * ENSNode GraphQL Query Utilities
 *
 * Adapted from CLI src/utils/ensnode.ts — accepts subgraphUrl directly
 * instead of looking up from config.
 */

export type ENSNodeDomain = {
	id: string;
	name: string;
	labelName: string | null;
	labelhash: string | null;
	owner: { id: string } | null;
	resolver: {
		id: string;
		address: string;
		texts: string[] | null;
	} | null;
	expiryDate: string | null;
	createdAt: string;
	registration: {
		registrationDate: string;
		expiryDate: string;
	} | null;
};

export type ENSNodeQueryResult<T> = {
	data: T;
	errors?: Array<{ message: string }>;
};

export async function queryENSNode<T>(
	query: string,
	variables: Record<string, unknown> | undefined,
	subgraphUrl: string,
): Promise<T> {
	const response = await fetch(subgraphUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ query, variables }),
	});

	if (!response.ok) {
		throw new Error(
			`ENSNode query failed: ${response.status} ${response.statusText}`,
		);
	}

	const result = (await response.json()) as ENSNodeQueryResult<T>;

	if (result.errors && result.errors.length > 0) {
		throw new Error(`ENSNode query error: ${result.errors[0].message}`);
	}

	return result.data;
}

export async function getDomainByName(
	name: string,
	subgraphUrl: string,
): Promise<ENSNodeDomain | null> {
	const query = `
    query GetDomain($name: String!) {
      domains(where: { name: $name }, first: 1) {
        id
        name
        labelName
        labelhash
        owner { id }
        resolver {
          id
          address
          texts
        }
        expiryDate
        createdAt
        registration {
          registrationDate
          expiryDate
        }
      }
    }
  `;

	const result = await queryENSNode<{ domains: ENSNodeDomain[] }>(
		query,
		{ name },
		subgraphUrl,
	);
	return result.domains[0] || null;
}

export async function getDomainsForAddress(
	address: string,
	subgraphUrl: string,
): Promise<ENSNodeDomain[]> {
	const addr = address.toLowerCase();

	const domainsQuery = `
    query GetDomains($owner: String!) {
      domains(where: { owner: $owner }, orderBy: createdAt, orderDirection: desc) {
        id
        name
        labelName
        labelhash
        owner { id }
        resolver {
          id
          address
          texts
        }
        expiryDate
        createdAt
        registration {
          registrationDate
          expiryDate
        }
      }
    }
  `;

	// Registrations query finds names by BaseRegistrar NFT owner (registrant).
	// Wrapped .eth names have NameWrapper as registry owner, so the domains query
	// alone misses them. Run this in parallel with a short timeout — if the
	// subgraph doesn't support this entity, we just use domains results.
	const registrationsQuery = `
    query GetRegistrations($owner: String!) {
      registrations(where: { registrant: $owner }, orderBy: registrationDate, orderDirection: desc) {
        domain {
          id
          name
          labelName
          labelhash
          owner { id }
          resolver {
            id
            address
            texts
          }
          expiryDate
          createdAt
          registration {
            registrationDate
            expiryDate
          }
        }
      }
    }
  `;

	const domainsPromise = queryENSNode<{ domains: ENSNodeDomain[] }>(
		domainsQuery,
		{ owner: addr },
		subgraphUrl,
	);

	// Run registrations query with a 5s timeout so it can't block the response
	const registrationsPromise = Promise.race([
		queryENSNode<{ registrations: Array<{ domain: ENSNodeDomain }> }>(
			registrationsQuery,
			{ owner: addr },
			subgraphUrl,
		),
		new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
	]).catch(() => null);

	const [domainsResult, registrationsResult] = await Promise.all([
		domainsPromise,
		registrationsPromise,
	]);

	const domains = domainsResult.domains;
	if (!registrationsResult) return domains;

	// Merge and deduplicate by domain id
	const seen = new Set(domains.map((d) => d.id));
	const merged = [...domains];
	for (const r of registrationsResult.registrations) {
		if (r.domain && !seen.has(r.domain.id)) {
			seen.add(r.domain.id);
			merged.push(r.domain);
		}
	}
	return merged;
}

export async function searchEnsNames(
	prefix: string,
	limit: number = 10,
	subgraphUrl: string,
): Promise<ENSNodeDomain[]> {
	const query = `
    query SearchNames($prefix: String!, $suffix: String!, $limit: Int!) {
      domains(
        where: {
          name_starts_with: $prefix,
          name_ends_with: $suffix
        }
        orderBy: createdAt
        orderDirection: desc
        first: $limit
      ) {
        id
        name
        labelName
        owner { id }
        expiryDate
        createdAt
      }
    }
  `;

	const result = await queryENSNode<{ domains: ENSNodeDomain[] }>(
		query,
		{ prefix, suffix: ".eth", limit },
		subgraphUrl,
	);
	return result.domains;
}
