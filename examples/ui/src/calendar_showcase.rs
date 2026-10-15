//! Date controls in the existing component showcase.

use topcoat::{
    Result,
    context::Cx,
    router::{content::Form, error::bad_request, href, route},
    runtime::signal,
    view::{View, ViewExt, ViewHandle, attributes, component, view},
};

use crate::components::{
    button::{ButtonVariant, button},
    calendar::{CalendarSelection, DateRangeValue, calendar},
    calendar_date::{CalendarDate, DateConstraints, DateRange, WeekStart},
    card::{card, card_content, card_description, card_header, card_title},
    date_picker::{date_picker, date_range_picker},
};

pub(crate) fn date(value: &str) -> CalendarDate {
    value.parse().expect("a fixed showcase date")
}

pub(crate) fn availability() -> DateConstraints {
    DateConstraints {
        min: Some(date("2026-01-01")),
        max: Some(date("2027-12-31")),
        disabled_ranges: vec![DateRange::new(date("2026-10-20"), date("2026-10-23")).unwrap()],
        ..Default::default()
    }
}

#[component]
pub(crate) async fn dates(cx: &Cx) -> Result<impl View> {
    let shipping = signal(cx, || "2026-10-15".to_owned());
    let range = signal(cx, DateRangeValue::default);
    let inline = signal(cx, || "2026-10-15".to_owned());
    let today = date("2026-10-15");
    Ok(view! {
        card(
            card_header(
                card_title("Dates")
                card_description(
                    "Choose a day or an inclusive range. October 20-23 is unavailable."
                )
            )
            card_content(
                <form method="post" action=(href!(submit)) class="space-y-5">
                    date_picker(
                        value: shipping,
                        today: today,
                        name: "ship_on",
                        label: "Ship date",
                        default_value: Some(today),
                        required: true,
                        constraints: availability()
                    )
                    date_range_picker(
                        value: range,
                        today: today,
                        start_name: "start",
                        end_name: "end",
                        label: "Delivery window (optional)",
                        constraints: availability(),
                        week_start: WeekStart::Sunday
                    )
                    <div class="flex gap-2">
                        button(attrs: attributes! { type="submit" }, "Submit dates")
                        button(
                            variant: ButtonVariant::Outline,
                            attrs: attributes! { type="reset" },
                            "Reset"
                        )
                    </div>
                </form>
                <div class="mt-6 border-t border-border pt-4">
                    <p class="mb-2 text-sm font-medium">"Inline calendar"</p>
                    calendar(
                        selection: CalendarSelection::Single(inline),
                        today: today,
                        constraints: availability()
                    )
                </div>
            )
        )
    })
}

#[route(POST "/calendar-submit")]
pub(crate) async fn submit(Form(values): Form<Vec<(String, String)>>) -> Result<ViewHandle> {
    let field = |name: &str| {
        values
            .iter()
            .find(|(key, _)| key == name)
            .map_or("", |(_, value)| value.as_str())
    };
    let shipping: CalendarDate = field("ship_on")
        .parse()
        .map_err(|error| bad_request(format!("{error}")))?;
    availability()
        .validate_date(shipping)
        .map_err(|error| bad_request(error.to_string()))?;
    let range = match (field("start"), field("end")) {
        ("", "") => None,
        (start, end) => {
            let start = start
                .parse()
                .map_err(|error| bad_request(format!("{error}")))?;
            let end = end
                .parse()
                .map_err(|error| bad_request(format!("{error}")))?;
            let range =
                DateRange::new(start, end).map_err(|error| bad_request(error.to_string()))?;
            availability()
                .validate_range(range)
                .map_err(|error| bad_request(error.to_string()))?;
            Some(range)
        }
    };
    view! {
        <!DOCTYPE html>
        <html>
            <head><title>"Submitted dates"</title></head>
            <body>
                <h1>"Submitted dates"</h1>
                <dl>
                    <dt>"Ship date"</dt>
                    <dd>(shipping.to_string())</dd>
                    if let Some(range) = range {
                        <dt>"Start"</dt>
                        <dd>(range.start().to_string())</dd>
                        <dt>"End"</dt>
                        <dd>(range.end().to_string())</dd>
                    }
                </dl>
                <a href=(href!(crate::home).fragment("dates"))>
                    "Back to the showcase"
                </a>
            </body>
        </html>
    }
    .single()
    .await
}
