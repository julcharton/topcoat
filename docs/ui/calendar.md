The calendar and date pickers edit Gregorian dates without a time or timezone. The server calculates dates, renders months, and validates drafts. Native text inputs supply form values, and a native non-modal popover contains the picker calendar.

# Install and use

Run `topcoat ui add date_picker`. This also installs `calendar`, the date helpers, and the input and floating styles. For an inline calendar alone, run `topcoat ui add calendar`. Register the installed shards with `.discover()`, and load the runtime script and your theme stylesheet as described in the [UI guide](../ui.md).

The application supplies `today` as a civil date. The component does not infer the browser's timezone. This example is compiled in the UI example's tests, and a drift check keeps it identical to the published snippet.

```rust
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
```

# Values and availability

`CalendarDate::new(year, month, day)` and `str::parse::<CalendarDate>()` reject impossible dates. Parsing accepts exactly ASCII `YYYY-MM-DD` in years 0001 through 9999. Display produces the same format. Timestamps, offsets, whitespace, and alternate formats are invalid. `DateRange::new(start, end)` makes an inclusive ordered range. Equal endpoints select one day.

`DateConstraints` has optional inclusive `min` and `max`, plus `disabled_dates` and inclusive `disabled_ranges`. `validate_date` and `validate_range` check trusted application rules. A range is invalid if any interior date is unavailable. Contradictory bounds return an error. The private request format checks its date facts and limits pending navigation to 256 commands and availability to 4096 intervals.

A picker owns no application state. Pass `Signal<String>` to `date_picker`, or `Signal<DateRangeValue>` to `date_range_picker`. The range record has editable `start` and `end` strings and an empty default. It permits partial and invalid drafts. Replace the pair with one signal write when changing it externally. Checked dates and ranges remain the application's server-side domain values.

The inline `calendar` accepts `CalendarSelection::Single(value)` or `CalendarSelection::Range(value)`. It adds no named form input. All controls accept `initial_month`, `week_start`, `constraints`, `disabled`, and wrapper `attrs`. `WeekStart` offers all seven weekdays and defaults to Monday. Initial month defaults to the selection or `today`. On opening, a picker focuses a valid selected date, then eligible today, then the nearest available date, preferring forward on a tie. An all-disabled calendar keeps a readable fallback day and reports that no dates are available.

# Forms and reset

Single pickers require `name` and `label`. Range pickers require `start_name`, `end_name`, and the group's `label`. The two visible inputs have explicit start/end labels. `required` and `disabled` accept booleans or expressions. `form: Some("form-id")` associates the fields with an external form.

Optional empty values are valid. Both range endpoints must be empty or form a valid complete range. Required values must be complete. Disabled fields are omitted from native form data and constraint validation. They also disable the calendar and close its popover.

Manual entry uses text inputs with an ISO pattern. Each input event synchronously blocks checked submission while the server validates the draft. Impossible dates, disallowed dates, reversed ranges, and incomplete ranges remain visible and invalid. A response clears custom validity only if the draft, rules, required state, and revision still match. If a request fails, pending validity remains and Retry requests another result. Editing or navigating again can also recover. There is no browser date engine.

Use normal submit buttons or `requestSubmit()` for checked submission. `new FormData(form)` does not validate and can expose invalid drafts. Native `novalidate`, `formnovalidate`, and `form.submit()` keep their bypass semantics. Always parse the submitted strings and validate against trusted server rules in the form handler. The showcase's `/calendar-submit` handler demonstrates this check.

`default_value` controls reset and defaults to empty. It is separate from the current value signal. Supply both to reset to a prepopulated date. Signal edits do not change this baseline; replacing the component with a new explicit default does. An uncanceled reset restores native field values immediately, then synchronizes the signals and initial cursor, closes the popover, and invalidates pending focus and validation. Later listeners can cancel either user reset or `form.reset()`. A signal write after reset takes precedence over queued reset synchronization, including an equal-value write or writes that return to the previous value. Replacing the controller or removing the picker discards its pending reset completion.

`input_attrs`, or range `start_attrs` and `end_attrs`, forward presentation and accessibility attributes. A plain ASCII `id` may contain letters, digits, underscore, hyphen, colon, and period. `aria-describedby` adds to the component's description. Owned `type`, `value`, `required`, `disabled`, `readonly`, `name`, `form`, `pattern`, input/change handlers, bindings, and effect attributes cannot replace the component's behavior. Use the public props for those values.

# Interaction

Arrow keys move one day or week. Home and End use the configured week start. Page Up and Page Down move one month; Shift moves one year. Month/year moves clamp to the last day. Navigation changes focus without selecting. A move made while selection or navigation is pending joins the ordered command queue, so an older response cannot undo it. Unavailable dates remain reachable for announcement, but Enter, Space, and pointer activation reject them.

A range's first date starts a draft. An earlier second date starts over. A later or equal second date completes an allowed inclusive range. A disabled interior rejects completion while preserving the start. Clear empties both fields. Dismissal preserves incomplete drafts.

The popup is a named non-modal dialog region. It does not trap focus. Escape and completed selection return focus to its trigger. Native outside dismissal and Tab follow browser focus rules. Pending server responses cannot take focus after closing, disabling, moving outside, returning to the text input, removal, or navigation. Month buttons retain focus so repeated activation works. The initial language is English; week start is configurable.

# Run the native checks

From the workspace root, use an available port and this worktree's own target directory:

```sh
CARGO_BUILD_JOBS=2 cargo topcoat asset bundle --package ui
CARGO_BUILD_JOBS=2 cargo build -p ui --locked
HOST=127.0.0.1 PORT=4317 ./target/debug/ui
```

In a second terminal:

```sh
cd crates/topcoat-runtime/browser
yarn install --frozen-lockfile
yarn playwright install --with-deps chromium firefox webkit
CALENDAR_URL=http://127.0.0.1:4317 yarn test:calendar
```

The committed `/calendar-tests`, `/calendar-live-tests`, and `/calendar-reset-tests` routes render installed Rust components. Rebuilding the UI binary regenerates their actual HTML and compiled handlers. There is no separately maintained JavaScript implementation or serialized fixture. The registry synchronization tests check installed source and hashes, and the native harness exercises Chromium, Firefox, and WebKit. Set `CALENDAR_SCREENSHOTS` to an output directory to capture the existing showcase at desktop and 320-pixel widths in light and dark themes. Stop only the server you started.
