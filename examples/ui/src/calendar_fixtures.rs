//! Live fixtures for native tests. All behavior comes from installed Rust components.

use topcoat::{
    Result,
    context::Cx,
    router::{href, page, query_params},
    runtime::{Event, Signal, link, shard, signal},
    view::{View, attributes, component, emit, live, view},
};

use crate::{
    calendar_showcase::date,
    components::{
        calendar::{CalendarSelection, DateRangeValue, calendar},
        calendar_date::{DateConstraints, DateRange, WeekStart},
        date_picker::{date_picker, date_range_picker},
    },
};

#[query_params]
struct FixtureQuery {
    theme: Option<String>,
}

fn rules() -> DateConstraints {
    DateConstraints {
        min: Some(date("2024-01-01")),
        max: Some(date("2026-12-31")),
        disabled_ranges: vec![DateRange::new(date("2024-02-10"), date("2024-02-12")).unwrap()],
        ..Default::default()
    }
}

#[page("/calendar-tests")]
async fn fixtures(cx: &Cx) -> Result<impl View> {
    let dark =
        query_params::<FixtureQuery>(cx).is_ok_and(|query| query.theme.as_deref() == Some("dark"));
    let single = signal(cx, || "2024-01-31".to_owned());
    let range = signal(cx, DateRangeValue::default);
    let inline = signal(cx, || "2024-01-31".to_owned());
    let inline_disabled = signal(cx, || false);
    let external = signal(cx, || "2024-02-01".to_owned());
    let disabled = signal(cx, || true);
    let disabled_value = signal(cx, || "2024-01-15".to_owned());
    let reordered = signal(cx, || false);
    let shown = signal(cx, || true);
    let today = date("2024-01-31");
    Ok(view! {
        <!DOCTYPE html>
        <html
            class=(dark.then_some("dark"))
            style=(if dark { "color-scheme: dark" } else { "color-scheme: light" })
        >
            <head>
                <title>"Calendar native tests"</title>
                <meta name="viewport" content="width=device-width, initial-scale=1">
                topcoat::runtime::script()
                <link rel="stylesheet" href=(topcoat::tailwind::stylesheet!())>
            </head>
            <body class="mx-auto max-w-3xl space-y-8 p-4">
                <h1 class="text-xl font-semibold">"Calendar native tests"</h1>
                <button type="button" id="outside">"Outside focus"</button>
                <form id="dates-form" class="space-y-5">
                    date_picker(
                        value: single,
                        today: today,
                        name: "single",
                        label: "Single date",
                        default_value: Some(today),
                        required: true,
                        constraints: rules(),
                        attrs: attributes! { id="single-picker" }
                    )
                    date_range_picker(
                        value: range,
                        today: today,
                        start_name: "start",
                        end_name: "end",
                        label: "Date range",
                        constraints: rules(),
                        week_start: WeekStart::Sunday,
                        attrs: attributes! { id="range-picker" }
                    )
                    date_picker(
                        value: disabled_value,
                        today: today,
                        name: "disabled",
                        label: "Disabled date",
                        disabled: $(disabled.get()),
                        attrs: attributes! { id="disabled-picker" }
                    )
                    <button
                        type="button"
                        id="enable"
                        @click=$(|_e: Event| disabled.toggle())
                    >
                        "Toggle disabled"
                    </button>
                    <button type="reset" id="reset-form">"Reset"</button>
                    <button type="submit" id="submit-form">"Submit"</button>
                </form>
                <form id="external-form">
                    <button type="reset" id="external-reset">"Reset external"</button>
                </form>
                date_picker(
                    value: external,
                    today: today,
                    name: "external",
                    label: "External form date",
                    form: Some("external-form"),
                    default_value: Some(date("2024-02-01")),
                    attrs: attributes! { id="external-picker" }
                )
                <div id="inline-calendar">
                    calendar(
                        selection: CalendarSelection::Single(inline),
                        disabled: $(inline_disabled.get()),
                        today: today,
                        constraints: rules()
                    )
                </div>
                <button
                    type="button"
                    id="disable-inline"
                    @click=$(|_e: Event| inline_disabled.toggle())
                >
                    "Toggle inline disabled"
                </button>
                <button
                    type="button"
                    id="reorder"
                    @click=$(|_e: Event| reordered.toggle())
                >
                    "Reorder"
                </button>
                <button type="button" id="remove" @click=$(|_e: Event| shown.toggle())>
                    "Toggle instances"
                </button>
                <form id="instances-form">
                    instances(reordered: reordered, shown: shown)
                </form>
                edge_cases()
                link(
                    href: href!(crate::home),
                    attrs: attributes! { id="navigate" },
                    "Showcase"
                )
            </body>
        </html>
    })
}

#[component]
async fn edge_cases(cx: &Cx) -> Result<impl View> {
    let fallback = signal(cx, String::new);
    let unavailable = signal(cx, String::new);
    Ok(view! {
        date_picker(
            value: fallback,
            today: date("2024-02-11"),
            name: "fallback",
            label: "Nearest available date",
            constraints: rules(),
            attrs: attributes! { id="fallback-picker" }
        )
        date_picker(
            value: unavailable,
            today: date("2024-01-05"),
            name: "unavailable",
            label: "No available dates",
            constraints: DateConstraints {
                min: Some(date("2024-01-01")),
                max: Some(date("2024-01-10")),
                disabled_ranges: vec![
                    DateRange::new(date("2024-01-01"), date("2024-01-10")).unwrap(),
                ],
                ..Default::default()
            },
            attrs: attributes! { id="unavailable-picker" }
        )
    })
}

#[page("/calendar-live-tests")]
async fn live_fixtures() -> Result<impl View> {
    Ok(view! {
        <!DOCTYPE html>
        <html>
            <head>
                <title>"Calendar live replacement"</title>
                topcoat::runtime::script()
                <link rel="stylesheet" href=(topcoat::tailwind::stylesheet!())>
            </head>
            <body>
                <button type="button" id="outside">"Outside focus"</button>
                <form id="live-form">
                    (live! {
                        emit! { instance(key: 8) }?;
                        tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
                        emit! { instance(key: 9) }
                    })
                </form>
            </body>
        </html>
    })
}

#[shard]
async fn instances(reordered: Signal<bool>, shown: Signal<bool>) -> Result<impl View> {
    let keys = if reordered.get() { [2, 1] } else { [1, 2] };
    Ok(view! {
        <div id="instances">
            if shown.get() {
                #[key(key)]
                for key in keys {
                    instance(key: key)
                }
            }
        </div>
    })
}

#[component]
async fn instance(cx: &Cx, key: i32) -> Result<impl View> {
    let value = signal(cx, || "2024-01-15".to_owned());
    Ok(view! {
        let name = format!("instance-{key}");
        let label = format!("Instance {key}");
        date_picker(
            value: value,
            today: date("2024-01-31"),
            name: &name,
            label: &label,
            attrs: attributes! { data-instance=(key) }
        )
    })
}
