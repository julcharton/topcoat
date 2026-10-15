// Drives the installed Rust components served by examples/ui. No control behavior
// is reproduced here. See docs/ui/calendar.md for the server and test commands.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, firefox, webkit } from "playwright";
import { focusRegressions } from "./calendar.focus.mjs";
import {
	active,
	day,
	engines,
	eventually,
	holdResponses,
	input,
	open,
	origin,
	picker,
	range,
	rangeAppearance,
	screenshots,
	settled,
	trigger,
	validity,
	visiblePopup,
} from "./calendar.helpers.mjs";
import { reviewRegressions } from "./calendar.review.mjs";

const tests = [];
const test = (name, run) => tests.push({ name, run });
reviewRegressions(test);
focusRegressions(test);

test("SSR semantics, names, defaults, and distinct identifiers", async (page) => {
	assert.equal(await page.locator(`${picker} [role=grid] tbody tr`).count(), 6);
	assert.equal(await page.locator(`${picker} [data-date]`).count(), 42);
	assert.equal(
		await page.locator(`${picker} [data-date][tabindex="0"]`).count(),
		1,
	);
	assert.equal(await page.locator(`${picker} [aria-current=date]`).count(), 1);
	assert.equal(
		await page.locator(`${picker} [popover]`).getAttribute("aria-modal"),
		null,
	);
	assert.equal(
		await page
			.locator(`${range} [role=grid]`)
			.getAttribute("aria-multiselectable"),
		"true",
	);
	assert.equal(
		await page.locator(`${range} th`).first().getAttribute("abbr"),
		"Sunday",
	);
	assert.equal(
		await page.locator(`${picker} th`).first().getAttribute("abbr"),
		"Monday",
	);
	const ids = await page
		.locator("[id]")
		.evaluateAll((nodes) => nodes.map((node) => node.id));
	assert.equal(new Set(ids).size, ids.length);
	assert.deepEqual(
		await page
			.locator("#dates-form")
			.evaluate((form) => [...new FormData(form)]),
		[
			["single", "2024-01-31"],
			["start", ""],
			["end", ""],
		],
	);
	assert.deepEqual(
		await page
			.locator("#external-form")
			.evaluate((form) => [...new FormData(form)]),
		[["external", "2024-02-01"]],
	);
	assert.equal(
		await page.locator(input).evaluate((field) => field.defaultValue),
		"2024-01-31",
	);
});

test("keyboard days, weeks, months, years, and native activation", async (page) => {
	await open(page);
	await page.keyboard.press("ArrowLeft");
	await active(page, "2024-01-30");
	await page.keyboard.press("ArrowUp");
	await active(page, "2024-01-23");
	await page.keyboard.press("ArrowDown");
	await active(page, "2024-01-30");
	await page.keyboard.press("Home");
	await active(page, "2024-01-29");
	await page.keyboard.press("End");
	await active(page, "2024-02-04");
	await page.keyboard.press("PageUp");
	await active(page, "2024-01-04");
	await page.locator(day(picker, "2024-01-31")).focus();
	await page.keyboard.press("PageDown");
	await active(page, "2024-02-29");
	await page.keyboard.press("Shift+PageDown");
	await active(page, "2025-02-28");
	await page.keyboard.press("Shift+PageUp");
	await active(page, "2024-02-28");
	assert.equal(await page.locator(input).inputValue(), "2024-01-31");
	await page.keyboard.press("Enter");
	await page.waitForFunction(
		(selector) =>
			!document.querySelector(`${selector} [popover]`).matches(":popover-open"),
		picker,
	);
	assert.equal(await page.locator(input).inputValue(), "2024-02-28");
	assert.equal(
		await page
			.locator(trigger(picker))
			.evaluate((button) => button === document.activeElement),
		true,
	);
	await validity(page, input, true);
});

test("ordered pending navigation and month-button focus", async (page) => {
	await open(page);
	const held = await holdResponses(page);
	await page.keyboard.press("PageDown");
	await held.wait();
	await page.keyboard.press("PageDown");
	await page.keyboard.press("ArrowRight");
	await held.wait(2);
	await held.release();
	await active(page, "2024-03-30");
	const next = page.locator(`${picker} button[aria-label="Next month"]`);
	await next.click();
	await settled(page);
	assert.equal(
		await next.evaluate((button) => button === document.activeElement),
		true,
	);
	assert.equal(
		await page
			.locator(`${picker} [data-calendar-month]`)
			.getAttribute("data-calendar-month"),
		"April 2024",
	);
});

test("modifiers, disabled dates, Space, and focus versus selection", async (page) => {
	await open(page);
	await page.keyboard.press("PageDown");
	await active(page, "2024-02-29");
	const target = page.locator(day(picker, "2024-02-10"));
	await target.focus();
	assert.equal(await target.getAttribute("aria-disabled"), "true");
	await page.keyboard.press("Space");
	assert.equal(await page.locator(input).inputValue(), "2024-01-31");
	await target.dispatchEvent("keydown", {
		key: "ArrowRight",
		isComposing: true,
	});
	await target.dispatchEvent("keydown", { key: "ArrowRight", ctrlKey: true });
	await active(page, "2024-02-10");
	await page.keyboard.press("ArrowRight");
	await active(page, "2024-02-11");
	await page.keyboard.press("ArrowRight");
	await active(page, "2024-02-12");
	await page.keyboard.press("ArrowRight");
	await active(page, "2024-02-13");
	await page.keyboard.press("Space");
	await validity(page, input, true);
	assert.equal(await page.locator(input).inputValue(), "2024-02-13");
});

test("range restart, same-day completion, and disabled interior", async (page) => {
	await open(page, range);
	await page.keyboard.press("PageDown");
	await active(page, "2024-02-29");
	await page.locator(day(range, "2024-02-08")).click();
	await validity(page, `${range} input`, false);
	await settled(page, range);
	await page.locator(day(range, "2024-02-13")).click();
	assert.deepEqual(
		await page
			.locator(`${range} input`)
			.evaluateAll((fields) => fields.map((field) => field.value)),
		["2024-02-08", ""],
	);
	assert.equal(
		await page
			.locator(`${range} [popover]`)
			.evaluate((panel) => panel.matches(":popover-open")),
		true,
	);
	await page.locator(day(range, "2024-02-07")).click();
	await eventually(
		async () =>
			(await page.locator(`${range} input`).first().inputValue()) ===
			"2024-02-07",
		"earlier date restarts range",
	);
	await settled(page, range);
	await page.locator(day(range, "2024-02-07")).click();
	await validity(page, `${range} input`, true);
	assert.deepEqual(
		await page
			.locator(`${range} input`)
			.evaluateAll((fields) => fields.map((field) => field.value)),
		["2024-02-07", "2024-02-07"],
	);
});

test("manual validation blocks pending, impossible, and stale drafts", async (page) => {
	const held = await holdResponses(page);
	await page.locator(input).fill("2024-02-29");
	await held.wait(2);
	assert.equal(
		await page.locator(picker).getAttribute("data-date-pending"),
		"true",
	);
	assert.equal(
		await page.locator(input).evaluate((field) => field.checkValidity()),
		false,
	);
	await page.locator("#dates-form").evaluate((form) => {
		window.submitted = false;
		form.addEventListener("submit", (event) => {
			event.preventDefault();
			window.submitted = true;
		});
		form.requestSubmit();
	});
	assert.equal(await page.evaluate(() => window.submitted), false);
	await page.locator(input).fill("2024-02-30");
	await held.wait(4);
	await held.release();
	await validity(page, input, false);
	assert.equal(await page.locator(input).inputValue(), "2024-02-30");
	await page.locator(input).fill("2024-02-11");
	await validity(page, input, false);
	await page.locator(input).fill("2024-03-01");
	await validity(page, input, true);
	await page.locator("#dates-form").evaluate((form) => form.requestSubmit());
	assert.equal(await page.evaluate(() => window.submitted), true);
	await page.locator(input).fill("");
	await validity(page, input, false);
	await page.locator("#enable").click();
	assert.equal(await page.locator("#disabled-picker input").isEnabled(), true);
});

test("manual ranges remain visible and invalid until authoritative acceptance", async (page) => {
	const fields = page.locator(`${range} input`);
	await fields.nth(0).fill("2024-02-13");
	await validity(page, `${range} input`, false);
	await fields.nth(1).fill("2024-02-08");
	await validity(page, `${range} input`, false);
	assert.equal(await fields.nth(1).inputValue(), "2024-02-08");
	await fields.nth(0).fill("2024-02-08");
	await fields.nth(1).fill("2024-02-13");
	await validity(page, `${range} input`, false);
	await fields.nth(0).fill("2024-02-13");
	await validity(page, `${range} input`, true);
	await fields.nth(0).fill("");
	await fields.nth(1).fill("");
	await validity(page, `${range} input`, true);
});

test("reset cancellation after component listeners for native and scripted reset", async (page) => {
	await page.locator(input).fill("2024-03-15");
	await validity(page, input, true);
	await page.evaluate(() => {
		window.cancelReset = (event) => event.preventDefault();
		document.addEventListener("reset", window.cancelReset);
	});
	await page.locator("#reset-form").click();
	await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
	await page.waitForLoadState("networkidle");
	assert.equal(await page.locator(input).inputValue(), "2024-03-15");
	await page.locator("#dates-form").evaluate((form) => form.reset());
	await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
	await page.waitForLoadState("networkidle");
	assert.equal(await page.locator(input).inputValue(), "2024-03-15");
	await page.evaluate(() =>
		document.removeEventListener("reset", window.cancelReset),
	);
	await page.locator("#dates-form").evaluate((form) => {
		form.addEventListener("reset", (event) => event.preventDefault(), {
			once: true,
		});
		form.reset();
	});
	await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
	await page.waitForLoadState("networkidle");
	assert.equal(await page.locator(input).inputValue(), "2024-03-15");
});

test("native reset defaults, external association, and later edits", async (page) => {
	await page.locator(input).fill("2024-03-15");
	await validity(page, input, true);
	assert.equal(
		await page.locator(input).evaluate((field) => field.defaultValue),
		"2024-01-31",
	);
	const immediate = await page.locator("#dates-form").evaluate((form) => {
		form.reset();
		return new FormData(form).get("single");
	});
	assert.equal(immediate, "2024-01-31");
	await validity(page, input, true);
	await page.waitForLoadState("networkidle");
	assert.equal(await page.locator(input).inputValue(), "2024-01-31");
	await page.locator("#dates-form").evaluate((form) => {
		const field = form.elements.namedItem("single");
		field.value = "2024-04-16";
		field.dispatchEvent(new Event("input", { bubbles: true }));
		form.reset();
	});
	await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
	await validity(page, input, true);
	assert.equal(
		await page.locator(input).inputValue(),
		"2024-01-31",
		"reset supersedes an earlier unflushed input binding",
	);
	await page.locator("#dates-form").evaluate((form) => {
		form.reset();
		const field = form.elements.namedItem("single");
		field.value = "2024-04-15";
		field.dispatchEvent(new Event("input", { bubbles: true }));
	});
	await validity(page, input, true);
	assert.equal(await page.locator(input).inputValue(), "2024-04-15");
	await page.locator("#external-picker input").fill("2024-04-01");
	await validity(page, "#external-picker input", true);
	await page.locator("#external-reset").click();
	await page.waitForFunction(
		() =>
			document.querySelector("#external-picker input").value === "2024-02-01",
	);
	await validity(page, "#external-picker input", true);
});

test("dismissal and outside focus invalidate delayed focus", async (page) => {
	await open(page);
	const held = await holdResponses(page);
	await page.keyboard.press("PageDown");
	await held.wait();
	// Native WebKit does not move pointer focus to buttons. A text input does.
	const outside = page.locator(`${range} input`).first();
	await outside.click();
	await held.release();
	await settled(page);
	assert.equal(
		await outside.evaluate((field) => field === document.activeElement),
		true,
	);
	assert.equal(
		await page
			.locator(`${picker} [popover]`)
			.evaluate((panel) => panel.matches(":popover-open")),
		false,
	);
	await open(page);
	await page.keyboard.press("Escape");
	await page.waitForFunction(
		(selector) => document.activeElement === document.querySelector(selector),
		trigger(picker),
	);
	await page.locator(day("#inline-calendar", "2024-01-31")).focus();
	await page.keyboard.press("Tab");
	assert.equal(
		await page
			.locator("#inline-calendar")
			.evaluate((root) => root.contains(document.activeElement)),
		false,
	);
});

test("keyed reorder, removal, and navigation preserve scope ownership", async (page) => {
	const first = '[data-instance="1"]';
	const listeners = () =>
		page.evaluate(
			() => window.resetSignals.filter((signal) => !signal.aborted).length,
		);
	const baseline = await listeners();
	const id = await page.locator(`${first} input`).getAttribute("id");
	await page.locator(`${first} input`).fill("2024-05-06");
	await validity(page, `${first} input`, true);
	await page.locator("#reorder").click();
	await page.waitForFunction(
		() =>
			document.querySelector("#instances [data-instance]").dataset.instance ===
			"2",
	);
	assert.equal(await page.locator(`${first} input`).getAttribute("id"), id);
	assert.equal(await page.locator(`${first} input`).inputValue(), "2024-05-06");
	assert.equal(await listeners(), baseline);
	await page.locator("#remove").click();
	await page.waitForFunction(
		() => !document.querySelector("#instances [data-instance]"),
	);
	assert.equal(await listeners(), baseline - 2);
	await page.locator("#remove").click();
	await page.locator(`${first} input`).waitFor();
	await eventually(
		async () => (await listeners()) === baseline,
		"reinstalled scopes own one reset listener each",
	);
	await open(page);
	const held = await holdResponses(page);
	await page.keyboard.press("PageDown");
	await held.wait();
	await page.locator("#navigate").click();
	await page.waitForURL(`${origin}/`);
	await held.release();
	assert.equal(await page.locator("#single-picker").count(), 0);
});

test("nearest available date and all-disabled fallback", async (page) => {
	await open(page, "#fallback-picker", "2024-02-13");
	await page.keyboard.press("Escape");
	await open(page, "#unavailable-picker", "2024-01-05");
	assert.equal(
		await page
			.locator("#unavailable-picker [data-date][aria-disabled=false]")
			.count(),
		0,
	);
	await page.keyboard.press("Enter");
	assert.equal(
		await page.locator("#unavailable-picker input").inputValue(),
		"",
	);
	await page.keyboard.press("Home");
	await active(page, "2024-01-01");
	await page.keyboard.press("PageUp");
	await active(page, "2024-01-01");
});

test("reset and reopen invalidate earlier navigation and validation", async (page) => {
	await open(page);
	const held = await holdResponses(page);
	await page.keyboard.press("PageDown");
	await held.wait();
	await page.locator("#dates-form").evaluate((form) => form.reset());
	await page.waitForFunction(
		(root) =>
			!document.querySelector(`${root} [popover]`).matches(":popover-open"),
		picker,
	);
	await page.locator(trigger(picker)).click();
	await held.wait(3);
	await held.release();
	await active(page, "2024-01-31");
	await validity(page, input, true);
	assert.equal(await page.locator(input).inputValue(), "2024-01-31");
});

test("disabled state cancels open interaction and Clear empties both endpoints", async (page) => {
	await page.locator("#enable").click();
	await open(page, "#disabled-picker", "2024-01-15");
	assert.equal(
		await page.locator("#disabled-picker [popover]").evaluate((panel) => {
			const bounds = panel.getBoundingClientRect();
			const focused = document.activeElement.getBoundingClientRect();
			return (
				panel.matches(":popover-open") &&
				bounds.top >= 0 &&
				bounds.bottom <= innerHeight &&
				focused.top >= bounds.top &&
				focused.bottom <= bounds.bottom
			);
		}),
		true,
		"native popup and focused day fit the viewport after enabling",
	);
	const held = await holdResponses(page);
	await page.keyboard.press("PageDown");
	await held.wait();
	// Keyboard activation retains native button focus in every engine.
	await page.locator("#enable").focus();
	await page.keyboard.press("Space");
	await held.release();
	await page.waitForLoadState("networkidle");
	assert.equal(await page.locator("#disabled-picker input").isDisabled(), true);
	assert.equal(
		await page
			.locator("#disabled-picker [popover]")
			.evaluate((panel) => panel.matches(":popover-open")),
		false,
	);
	assert.equal(
		await page
			.locator("#enable")
			.evaluate((button) => document.activeElement === button),
		true,
	);
	const fields = page.locator(`${range} input`);
	await fields.nth(0).fill("2024-03-01");
	await fields.nth(1).fill("2024-03-05");
	await validity(page, `${range} input`, true);
	await page
		.locator(range)
		.getByRole("button", { name: "Clear", exact: true })
		.click();
	await validity(page, `${range} input`, true);
	assert.deepEqual(
		await fields.evaluateAll((fields) => fields.map((field) => field.value)),
		["", ""],
	);
});

test("the inclusive range is visible in both showcase themes", async (page) => {
	for (const theme of ["light", "dark"]) {
		await page.goto(origin);
		if (theme === "dark")
			await page.getByRole("button", { name: "Switch to dark theme" }).click();
		const root = page.locator("#dates [data-date-picker]").nth(1);
		await root.locator("input").nth(0).fill("2026-10-16");
		await root.locator("input").nth(1).fill("2026-10-19");
		await validity(page, '#dates input[name="end"]', true);
		await root.locator("button[popovertarget]").click();
		await active(page, "2026-10-16");
		await rangeAppearance(root, [
			"2026-10-16",
			"2026-10-17",
			"2026-10-18",
			"2026-10-19",
		]);
	}
});

test("native popup fallback keeps the focused date visible at both viewport edges", async (page) => {
	await page.setViewportSize({ width: 320, height: 900 });
	await page.goto(origin);
	const root = page.locator("#dates [data-date-picker]").first();
	const button = root.locator("button[popovertarget]");
	for (const edge of ["top", "bottom"]) {
		await button.evaluate((button, edge) => {
			const rect = button.getBoundingClientRect();
			const top = edge === "top" ? 80 : innerHeight - 80 - rect.height;
			scrollBy(0, rect.top - top);
		}, edge);
		const trigger = await button.boundingBox();
		await button.click();
		await active(page, "2026-10-15");
		const state = await visiblePopup(root, "2026-10-15");
		if (edge === "top") assert(state.panel.top >= trigger.y + trigger.height);
		else assert(state.panel.bottom <= trigger.y);
		await page.keyboard.press("Escape");
	}
});

test("short viewport scrolls late-month focus inside the popup without moving the page", async (page) => {
	await page.setViewportSize({ width: 320, height: 400 });
	await page.goto(origin);
	await page.evaluate(() => document.fonts.ready);
	const root = page.locator("#dates [data-date-picker]").first();
	await root.locator("input").fill("2026-08-31");
	await validity(page, '#dates input[name="ship_on"]', true);
	const button = root.locator("button[popovertarget]");
	await button.evaluate((button) => button.scrollIntoView({ block: "center" }));
	const pageScroll = await page.evaluate(() => scrollY);
	await button.click();
	await active(page, "2026-08-31");
	await visiblePopup(root, "2026-08-31");
	assert.equal(await page.evaluate(() => scrollY), pageScroll);
	assert(
		await root
			.locator("[popover]")
			.evaluate((panel) => panel.scrollHeight > panel.clientHeight),
	);
	for (const [key, iso] of [
		["ArrowLeft", "2026-08-30"],
		["PageDown", "2026-09-30"],
	]) {
		await page.keyboard.press(key);
		await active(page, iso);
		await visiblePopup(root, iso);
		assert.equal(await page.evaluate(() => scrollY), pageScroll);
	}
});

test("scrolled showcase keeps popups and focused dates in view at every breakpoint", async (page) => {
	for (const [width, height] of [
		[320, 900],
		[1440, 1000],
		[1600, 900],
	]) {
		await page.setViewportSize({ width, height });
		for (const theme of ["light", "dark"]) {
			await page.goto(origin);
			if (theme === "dark")
				await page
					.getByRole("button", { name: "Switch to dark theme" })
					.click();
			const roots = page.locator("#dates [data-date-picker]");
			await roots.nth(1).locator("input").nth(0).fill("2026-10-16");
			await roots.nth(1).locator("input").nth(1).fill("2026-10-19");
			await validity(page, '#dates input[name="end"]', true);
			await page.locator("#dates").scrollIntoViewIfNeeded();
			if (width === 320)
				assert(await page.evaluate(() => scrollY > innerHeight));
			for (const [index, initial, next] of [
				[0, "2026-10-15", "2026-10-16"],
				[1, "2026-10-16", "2026-10-17"],
			]) {
				const root = roots.nth(index);
				await root
					.locator("button[popovertarget]")
					.evaluate((button) => button.scrollIntoView({ block: "center" }));
				const scroll = await page.evaluate(() => ({
					document: scrollY,
					main: document.querySelector("main").scrollTop,
					columns: getComputedStyle(document.querySelector("#components"))
						.columnCount,
				}));
				assert(
					scroll.document > 0 || scroll.main > 0,
					"a reachable scrolled state is exercised",
				);
				await root.locator("button[popovertarget]").click();
				await active(page, initial);
				await visiblePopup(root, initial);
				await page.keyboard.press("ArrowRight");
				await active(page, next);
				const geometry = await visiblePopup(root, next);
				console.log(
					"SHOWCASE_GEOMETRY",
					JSON.stringify({ width, height, theme, index, scroll, geometry }),
				);
				await page.keyboard.press("Escape");
			}
		}
	}
});

test("the showcase server rejects invalid and unavailable submitted dates", async (page) => {
	for (const form of [
		{ ship_on: "2026-02-30", start: "", end: "" },
		{ ship_on: "2026-10-15", start: "2026-10-19", end: "2026-10-24" },
		{ ship_on: "2026-10-15", start: "2026-10-19", end: "2026-10-18" },
	]) {
		const response = await page.request.post(`${origin}/calendar-submit`, {
			form,
		});
		assert.equal(response.status(), 400);
	}
	const accepted = await page.request.post(`${origin}/calendar-submit`, {
		form: { ship_on: "2026-10-15", start: "2026-10-16", end: "2026-10-19" },
	});
	assert.equal(accepted.status(), 200);
	assert.match(await accepted.text(), /2026-10-15/);
});

test("inline disabling updates native controls without waiting for a response", async (page) => {
	const held = await holdResponses(page);
	await page.locator("#disable-inline").click();
	await page.waitForFunction(() =>
		[...document.querySelectorAll("#inline-calendar button")].every(
			(button) => button.disabled,
		),
	);
	await page
		.locator(day("#inline-calendar", "2024-01-15"))
		.dispatchEvent("click");
	assert.equal(
		await page
			.locator("#inline-calendar [data-selected]")
			.getAttribute("data-date"),
		"2024-01-31",
	);
	await page.locator("#disable-inline").click();
	await page.waitForFunction(() =>
		[...document.querySelectorAll("#inline-calendar [data-date]")].every(
			(button) => !button.disabled,
		),
	);
	await held.release();
});

test("failed validation retains the guard and Retry recovers", async (page) => {
	await page.route("**/_topcoat/runtime/shards/**", (route) =>
		route.fulfill({ status: 503, body: "unavailable" }),
	);
	await page.locator(input).fill("2024-04-15");
	await page.waitForLoadState("networkidle");
	assert.equal(
		await page.locator(input).evaluate((field) => field.validity.valid),
		false,
	);
	await page.unroute("**/_topcoat/runtime/shards/**");
	await page.locator(`${picker} [data-date-validation]`).count();
	await page
		.locator(`${picker} button`)
		.filter({ hasText: "Retry" })
		.first()
		.click();
	await validity(page, input, true);
});

test("live replacement disposes old effects and installs working handlers", async (page) => {
	await page.goto(`${origin}/calendar-live-tests`, { waitUntil: "commit" });
	await page.locator('[data-instance="8"] input').waitFor();
	await page.locator('[data-instance="9"] input').waitFor();
	assert.equal(await page.locator('[data-instance="8"]').count(), 0);
	await eventually(
		async () =>
			(await page.evaluate(
				() => window.resetSignals.filter((signal) => !signal.aborted).length,
			)) === 1,
		"one live instance owns reset",
	);
	await open(page, '[data-instance="9"]', "2024-01-15");
	await page.keyboard.press("ArrowRight");
	await active(page, "2024-01-16");
	await page.keyboard.press("Enter");
	await validity(page, '[data-instance="9"] input', true);
	assert.equal(
		await page.locator('[data-instance="9"] input').inputValue(),
		"2024-01-16",
	);
});

for (const name of engines) {
	const browser = await { chromium, firefox, webkit }[name].launch();
	console.log(`${name} ${browser.version()}`);
	try {
		for (const { name: title, run } of tests) {
			const page = await browser.newPage();
			page.setDefaultTimeout(10000);
			const errors = [];
			page.on("pageerror", (error) => errors.push(error.message));
			await page.addInitScript(() => {
				window.resetSignals = [];
				const original = EventTarget.prototype.addEventListener;
				EventTarget.prototype.addEventListener = function (
					type,
					listener,
					options,
				) {
					if (type === "reset" && options?.signal)
						window.resetSignals.push(options.signal);
					return original.call(this, type, listener, options);
				};
			});
			try {
				await page.goto(`${origin}/calendar-tests`);
				await page.waitForLoadState("networkidle");
				await run(page);
				assert.deepEqual(errors, [], "compiled handler errors");
				console.log(`PASS ${title}`);
			} catch (error) {
				console.error(`FAIL ${title}`, errors);
				throw error;
			} finally {
				await page.unrouteAll({ behavior: "ignoreErrors" });
				await page.close();
			}
		}
		if (screenshots) {
			await mkdir(screenshots, { recursive: true });
			for (const [size, width, height] of [
				["desktop", 1440, 1000],
				["narrow", 320, 900],
			]) {
				for (const theme of ["light", "dark"]) {
					const page = await browser.newPage({ viewport: { width, height } });
					await page.goto(`${origin}/calendar-tests?theme=${theme}`);
					await open(page);
					assert.equal(
						await page.evaluate(
							() => document.documentElement.scrollWidth <= innerWidth,
						),
						true,
						"calendar fixture has no horizontal overflow",
					);
					await page.keyboard.press("Escape");
					await page.locator("#disabled-picker").screenshot({
						path: `${screenshots}/${name}-${size}-${theme}-disabled.png`,
					});
					await page.goto(origin);
					const baselineWidth = await page.evaluate(() => {
						const dates = document.querySelector("#dates");
						const previous = dates.style.display;
						dates.style.display = "none";
						const width = document.documentElement.scrollWidth;
						dates.style.display = previous;
						return width;
					});
					if (theme === "dark")
						await page
							.getByRole("button", { name: "Switch to dark theme" })
							.click();
					await page.locator("#dates").scrollIntoViewIfNeeded();
					await page.locator("#dates button[popovertarget]").first().click();
					await active(page, "2026-10-15");
					await page.keyboard.press("ArrowRight");
					await active(page, "2026-10-16");
					await visiblePopup(
						page.locator("#dates [data-date-picker]").first(),
						"2026-10-16",
					);
					assert.equal(
						await page.evaluate(
							(baseline) => document.documentElement.scrollWidth <= baseline,
							baselineWidth,
						),
						true,
						"date controls do not add showcase overflow",
					);
					assert.equal(
						await page
							.locator("#dates [popover]:popover-open")
							.evaluate((panel) => {
								const rect = panel.getBoundingClientRect();
								return rect.left >= 0 && rect.right <= innerWidth;
							}),
						true,
						"popup fits the viewport",
					);
					assert.equal(
						await page.locator("#dates").evaluate((section) => {
							const rect = section.getBoundingClientRect();
							return rect.left >= 0 && rect.right <= innerWidth;
						}),
						true,
						"date section fits the viewport",
					);
					await page.screenshot({
						path: `${screenshots}/${name}-${size}-${theme}.png`,
					});
					await page.keyboard.press("Escape");
					const window = page.locator("#dates [data-date-picker]").nth(1);
					await window.locator("input").nth(0).fill("2026-10-16");
					await window.locator("input").nth(1).fill("2026-10-19");
					await validity(page, '#dates input[name="end"]', true);
					await window.locator("button[popovertarget]").click();
					await active(page, "2026-10-16");
					await page.keyboard.press("ArrowRight");
					await active(page, "2026-10-17");
					await visiblePopup(window, "2026-10-17");
					const appearance = await rangeAppearance(window, [
						"2026-10-16",
						"2026-10-17",
						"2026-10-18",
						"2026-10-19",
					]);
					await writeFile(
						`${screenshots}/${name}-${size}-${theme}-range-styles.json`,
						JSON.stringify(appearance, null, 2),
					);
					await page.screenshot({
						path: `${screenshots}/${name}-${size}-${theme}-range.png`,
					});
					await page.close();
				}
			}
		}
		console.log(
			`${name}: ${tests.length} native scenarios passed at ${origin}`,
		);
	} finally {
		await browser.close();
	}
}
