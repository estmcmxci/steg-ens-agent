import { parseAbi } from 'viem/utils'

export const ethRegistrarControllerAbi = [
  {
    name: 'commit',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'commitment', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'register',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'registration',
        type: 'tuple',
        components: [
          { name: 'label', type: 'string' },
          { name: 'owner', type: 'address' },
          { name: 'duration', type: 'uint256' },
          { name: 'secret', type: 'bytes32' },
          { name: 'resolver', type: 'address' },
          { name: 'data', type: 'bytes[]' },
          { name: 'reverseRecord', type: 'uint8' },
          { name: 'referrer', type: 'bytes32' },
        ],
      },
    ],
    outputs: [],
  },
  {
    name: 'renew',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'label', type: 'string' },
      { name: 'duration', type: 'uint256' },
      { name: 'referrer', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    name: 'rentPrice',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'label', type: 'string' },
      { name: 'duration', type: 'uint256' },
    ],
    outputs: [
      {
        name: 'price',
        type: 'tuple',
        components: [
          { name: 'base', type: 'uint256' },
          { name: 'premium', type: 'uint256' },
        ],
      },
    ],
  },
  {
    name: 'available',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'label', type: 'string' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'makeCommitment',
    type: 'function',
    stateMutability: 'pure',
    inputs: [
      {
        name: 'registration',
        type: 'tuple',
        components: [
          { name: 'label', type: 'string' },
          { name: 'owner', type: 'address' },
          { name: 'duration', type: 'uint256' },
          { name: 'secret', type: 'bytes32' },
          { name: 'resolver', type: 'address' },
          { name: 'data', type: 'bytes[]' },
          { name: 'reverseRecord', type: 'uint8' },
          { name: 'referrer', type: 'bytes32' },
        ],
      },
    ],
    outputs: [{ name: '', type: 'bytes32' }],
  },
] as const

export const publicResolverAbi = [
  {
    name: 'setAddr',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'addr', type: 'address' },
    ],
    outputs: [],
  },
  {
    name: 'setAddr',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'coinType', type: 'uint256' },
      { name: 'addr', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'setText',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
      { name: 'value', type: 'string' },
    ],
    outputs: [],
  },
  {
    name: 'setContenthash',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'hash', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'multicall',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'data', type: 'bytes[]' }],
    outputs: [{ name: 'results', type: 'bytes[]' }],
  },
] as const

export const baseRegistrarAbi = parseAbi([
  'function controllers(address) external view returns (bool)',
  'function nameExpires(uint256 id) external view returns (uint256)',
])

export const ensRegistryAbi = parseAbi([
  'function owner(bytes32 node) external view returns (address)',
  'function resolver(bytes32 node) external view returns (address)',
  'function setSubnodeOwner(bytes32 node, bytes32 label, address owner) external returns (bytes32)',
  'function setSubnodeRecord(bytes32 node, bytes32 label, address owner, address resolver, uint64 ttl) external',
])

export const universalResolverAbi = parseAbi([
  'function supportsInterface(bytes4 interfaceId) external view returns (bool)',
  'function findExactRegistry(bytes name) external view returns (address)',
  'function findCanonicalRegistry(bytes name) external view returns (address)',
  'function findResolver(bytes name) external view returns ((address resolver, bytes32 node, uint256 offset))',
  'error DNSDecodingFailed(bytes dns)',
  'error LabelIsTooLong(string label)',
  'error LabelIsEmpty()',
])

export const v2RegistryAbi = parseAbi([
  'function getState(uint256 anyId) external view returns ((uint8 status, uint64 expiry, address latestOwner, uint256 tokenId, uint256 resource))',
  'function ownerOf(uint256 tokenId) external view returns (address)',
])

export const nameWrapperAbi = parseAbi([
  'function ownerOf(uint256 id) external view returns (address)',
  'function setSubnodeOwner(bytes32 parentNode, string label, address owner, uint32 fuses, uint64 expiry) external returns (bytes32)',
  'function setSubnodeRecord(bytes32 parentNode, string label, address owner, address resolver, uint64 ttl, uint32 fuses, uint64 expiry) external returns (bytes32)',
])

export const addresses = {
  mainnet: {
    registry: '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e' as const,
    baseRegistrar: '0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85' as const,
    controller: '0x59E16fcCd424Cc24e280Be16E11Bcd56fb0CE547' as const,
    resolver: '0xF29100983E058B709F3D539b0c765937B804AC15' as const,
    universalResolver: '0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe' as const,
    nameWrapper: '0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401' as const,
  },
  sepolia: {
    registry: '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e' as const,
    baseRegistrar: '0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85' as const,
    controller: '0xfb3cE5D01e0f33f41DbB39035dB9745962F1f968' as const,
    resolver: '0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5' as const,
    universalResolver: '0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe' as const,
    nameWrapper: '0x0635513f179D50A207757E05759CbD106d7dFcE8' as const,
  },
} as const

export type Chain = keyof typeof addresses
