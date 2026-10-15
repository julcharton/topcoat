use topcoat::{
    Result,
    context::Cx,
    runtime::signal,
    view::{View, component, view},
};

use crate::components::{
    calendar::{CalendarSelection, DateRangeValue, calendar},
    calendar_date::{CalendarDate, DateConstraints, DateRange},
    date_picker::{date_picker, date_range_picker},
};

#[component]
async fn booking(cx: &Cx) -> Result<impl View> {
    let today = CalendarDate::new(2026, 10, 15)?;
    let shipping = signal(cx, || today.to_string());
    let window = signal(cx, DateRangeValue::default);
    let inline = signal(cx, String::new);
    let constraints = DateConstraints {
        min: Some(today),
        disabled_ranges: vec![DateRange::new(
            CalendarDate::new(2026, 10, 20)?,
            CalendarDate::new(2026, 10, 23)?,
        )?],
        ..Default::default()
    };
    Ok(view! {
        <form method="post" action="/book">
            date_picker(
                value: shipping,
                today: today,
                name: "ship_on",
                label: "Ship date",
                default_value: Some(today),
                required: true,
                constraints: constraints.clone()
            )
            date_range_picker(
                value: window,
                today: today,
                start_name: "start",
                end_name: "end",
                label: "Delivery window",
                constraints: constraints.clone()
            )
            <button type="submit">"Book"</button>
            <button type="reset">"Reset"</button>
        </form>
        calendar(
            selection: CalendarSelection::Single(inline),
            today: today,
            constraints: constraints
        )
    })
}
