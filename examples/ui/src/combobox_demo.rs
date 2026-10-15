use topcoat::{
    Result,
    context::Cx,
    runtime::{Event, Signal, shard, signal},
    view::{View, attributes, component, element_id, view},
};

use crate::components::{
    button::{ButtonVariant, button},
    card::{card, card_content, card_description, card_header, card_title},
    checkbox::checkbox,
    combobox::{ComboboxOption, ComboboxState, combobox, combobox_results},
    field::{field, field_description, field_label},
};

/// The catalog is loaded and searched on the server. A real application checks
/// access in this loader on every request, including requests to the shard.
fn regions(frankfurt_closed: bool) -> Vec<ComboboxOption> {
    [
        ("us-east-1", "Northern Virginia", false),
        ("us-west-2", "Oregon", false),
        ("eu-central-1", "Frankfurt", frankfurt_closed),
        ("eu-west-2", "London", false),
        ("ap-northeast-1", "Tokyo", false),
        ("ap-southeast-2", "Sydney", false),
        ("ca-central-1", "Montreal", false),
        ("sa-east-1", "Sao Paulo", true),
    ]
    .into_iter()
    .map(|(value, label, disabled)| ComboboxOption {
        value: value.to_owned(),
        label: label.to_owned(),
        disabled,
    })
    .collect()
}

#[shard]
async fn region_results(state: ComboboxState, closed: Signal<bool>) -> Result<impl View> {
    let options = regions(closed.get());
    Ok(view! { combobox_results(state: state, options: &options) })
}

#[component]
pub async fn combobox_demo(cx: &Cx) -> Result<impl View> {
    let catalog = regions(false);
    let primary = ComboboxState::new(cx, &catalog, Some("eu-central-1"))?;
    let backup = ComboboxState::new(cx, &catalog, None)?;
    let closed = signal(cx, || false);
    let submitted = signal(cx, String::new);
    let submitted_backup = signal(cx, String::new);
    let primary_value = primary.value();
    let backup_value = backup.value();
    let primary_hint = element_id(cx);
    let backup_hint = element_id(cx);
    let closed_id = element_id(cx);
    Ok(view! {
        card(
            card_header(
                card_title("Searchable regions")
                card_description(
                    "Type to search, then choose a region for your deployment."
                )
            )
            card_content(
                <form
                    class="flex flex-col gap-5"
                    @submit=$(|event: Event| {
                        event.prevent_default();
                        submitted.set(primary_value.unwrap());
                        submitted_backup.set(
                            if backup_value.is_some() {
                                backup_value.unwrap()
                            } else {
                                "none".to_owned()
                            },
                        );
                    })
                    @reset=$(|_event: Event| submitted.set("".to_owned()))
                >
                    field(
                        field_label(
                            attrs: attributes! { for=(primary.input_id()) },
                            "Primary region"
                        )
                        combobox(
                            state: primary.clone(),
                            name: "region",
                            required: true,
                            attrs: attributes! {
                                placeholder="Search regions..."
                                aria-describedby=(&primary_hint)
                            },
                            region_results(
                                state: primary.clone(),
                                closed: closed.clone()
                            )
                        )
                        field_description(
                            attrs: attributes! { id=(&primary_hint) },
                            "Required. Suggestions are searched on the server."
                        )
                    )
                    field(
                        field_label(
                            attrs: attributes! { for=(backup.input_id()) },
                            "Backup region"
                        )
                        combobox(
                            state: backup.clone(),
                            name: "backup",
                            attrs: attributes! {
                                placeholder="Choose an optional backup..."
                                aria-describedby=(&backup_hint)
                            },
                            region_results(
                                state: backup.clone(),
                                closed: closed.clone()
                            )
                        )
                        field_description(
                            attrs: attributes! { id=(&backup_hint) },
                            "Optional. Sao Paulo is currently unavailable."
                        )
                    )
                    <div class="flex items-center gap-2">
                        checkbox(
                            attrs: attributes! {
                                id=(&closed_id)
                                :checked=$(closed.get())
                                @change=$(|event: Event| closed.set(event.target.checked))
                            }
                        )
                        <label for=(&closed_id) class="text-sm">
                            "Temporarily close Frankfurt"
                        </label>
                    </div>
                    <div class="flex flex-wrap justify-end gap-2">
                        button(
                            variant: ButtonVariant::Outline,
                            attrs: attributes! { type="reset" },
                            "Reset regions"
                        )
                        button(attrs: attributes! { type="submit" }, "Save regions")
                    </div>
                    <p
                        role="status"
                        class="text-sm text-muted-foreground"
                        :hidden=$(submitted.get().is_empty())
                    >
                        "Saved primary: "
                        <code>$(submitted.get())</code>
                        "; backup: "
                        <code>$(submitted_backup.get())</code>
                    </p>
                </form>
            )
        )
    })
}
