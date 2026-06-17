"""Widget builders for ENS transaction cards and previews."""

from typing import Any

from chatkit.actions import ActionConfig
from chatkit.widgets import Badge, Button, Card, Col, Row, Text, Title


def build_tx_card(
    operation: str,
    tx: dict[str, Any],
    price_eth: str | None = None,
) -> Card:
    """Build a 'Sign Transaction' card for a single transaction."""
    children: list = [
        Title(value=operation),
        Text(value=f"Contract: `{tx['to']}`", size="sm", color="secondary"),
    ]

    value_wei = tx.get("value", "0")
    if value_wei and value_wei != "0":
        children.append(Text(value=f"Value: {value_wei} wei", size="sm"))

    if price_eth:
        children.append(
            Text(value=f"Price: **{price_eth} ETH** (includes 10% buffer, excess refunded)", size="sm")
        )

    children.append(
        Row(children=[
            Button(
                label="Sign Transaction",
                style="primary",
                onClickAction=ActionConfig(
                    type="sign_transaction",
                    payload={"tx": tx},
                    handler="client",
                ),
            ),
        ])
    )

    return Card(children=children, size="md")


def build_countdown_card(wait_seconds: int) -> Card:
    """Build a countdown card for the commit-reveal wait period."""
    return Card(
        children=[
            Title(value="Waiting for commit to mature"),
            Text(
                value=f"Please wait ~{wait_seconds} seconds before the registration can be completed.",
                size="sm",
            ),
            Button(
                label="Ready to Register",
                style="primary",
                onClickAction=ActionConfig(
                    type="countdown_complete",
                    payload={"wait_seconds": wait_seconds},
                    handler="server",
                ),
            ),
        ],
        size="md",
    )


def build_records_preview(
    records_set: list[str],
    warnings: list[str] | None = None,
) -> Card:
    """Build a preview card showing which records will be set."""
    children: list = [Title(value="Records to set")]

    for record in records_set:
        children.append(Text(value=f"- {record}", size="sm"))

    if warnings:
        children.append(Text(value="**Warnings:**", size="sm", color="warning"))
        for warning in warnings:
            children.append(
                Row(children=[
                    Badge(label="!", color="warning", size="sm"),
                    Text(value=warning, size="sm"),
                ])
            )

    return Card(children=children, size="md")


def build_subname_steps(transactions: list[dict[str, Any]]) -> Card:
    """Build a multi-step progress card for subname creation."""
    step_labels = {
        "create_subname": "Create subname",
        "set_address": "Set address record",
        "set_reverse": "Set reverse record",
    }

    children: list = [Title(value="Subname Creation")]

    for i, entry in enumerate(transactions, 1):
        step = entry.get("step", f"step_{i}")
        label = step_labels.get(step, step)
        tx = entry.get("tx", {})

        children.append(
            Col(children=[
                Text(value=f"**Step {i}: {label}**", size="sm"),
                Button(
                    label=f"Sign Step {i}",
                    style="primary",
                    onClickAction=ActionConfig(
                        type="sign_transaction",
                        payload={"tx": tx, "step": step, "step_index": i},
                        handler="client",
                    ),
                ),
            ])
        )

    return Card(children=children, size="md")
