import assert from "node:assert/strict";

export const origin = process.env.CALENDAR_URL ?? "http://127.0.0.1:4317";
export const screenshots = process.env.CALENDAR_SCREENSHOTS;
export const engines = process.env.CALENDAR_ENGINE
	? [process.env.CALENDAR_ENGINE]
	: ["chromium", "firefox", "webkit"];
export const picker = "#single-picker";
export const range = "#range-picker";
export const input = `${picker} input`;
export const day = (root, iso) => `${root} [data-date="${iso}"]`;
export const trigger = (root) => `${root} button[popovertarget]`;

export async function eventually(check, message) {
	const deadline = Date.now() + 10000;
	while (Date.now() < deadline) {
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	assert.fail(message);
}

export async function active(page, iso) {
	await page.waitForFunction(
		(value) => document.activeElement?.dataset.date === value,
		iso,
	);
}

export async function visiblePopup(root, iso) {
	const panel = root.locator("[popover]");
	await panel.evaluate((panel) =>
		Promise.all(panel.getAnimations().map((animation) => animation.finished)),
	);
	const state = await panel.evaluate((panel) => {
		const focused = document.activeElement;
		return {
			open: panel.matches(":popover-open"),
			active: focused?.dataset.date,
			containsFocus: panel.contains(focused),
			panel: panel.getBoundingClientRect().toJSON(),
			day: focused.getBoundingClientRect().toJSON(),
			width: innerWidth,
			height: innerHeight,
		};
	});
	assert.equal(state.open, true, "native popup is open");
	assert.equal(state.active, iso, "the exact date owns focus");
	assert.equal(state.containsFocus, true);
	assert(
		state.panel.left >= 0 &&
			state.panel.right <= state.width &&
			state.panel.top >= 0 &&
			state.panel.bottom <= state.height,
		`popup fits the viewport: ${JSON.stringify(state)}`,
	);
	assert(
		state.day.width > 0 &&
			state.day.height > 0 &&
			state.day.left >= state.panel.left &&
			state.day.right <= state.panel.right &&
			state.day.top >= state.panel.top &&
			state.day.bottom <= state.panel.bottom,
		`focused date is visible inside the popup: ${JSON.stringify(state)}`,
	);
	return state;
}

export async function open(page, root = picker, iso = "2024-01-31") {
	await page.locator(trigger(root)).click();
	await active(page, iso);
}

export async function validity(page, selector, valid) {
	await page.waitForFunction(
		({ selector, valid }) =>
			document.querySelector(selector).validity.valid === valid &&
			document.querySelector(selector).closest("[data-date-picker]").dataset
				.datePending === "false",
		{ selector, valid },
	);
}

export async function settled(page, root = picker) {
	await page.waitForFunction(
		(root) =>
			document
				.querySelector(`${root} [role=grid]`)
				.getAttribute("aria-busy") === "false",
		root,
	);
}

export async function rangeAppearance(root, dates) {
	const cells = await root.locator("[data-date]").evaluateAll((days) =>
		days.map((day) => ({
			date: day.dataset.date,
			selected: day.getAttribute("data-selected"),
			ariaSelected: day.closest("td").getAttribute("aria-selected"),
			background: getComputedStyle(day).backgroundColor,
			color: getComputedStyle(day).color,
		})),
	);
	const selected = cells.filter((cell) => dates.includes(cell.date));
	assert.equal(selected.length, dates.length);
	const outside = cells.find((cell) => !dates.includes(cell.date));
	for (const cell of selected) {
		assert.equal(cell.selected, "true", `${cell.date} selected`);
		assert.equal(
			cell.ariaSelected,
			"true",
			`${cell.date} accessible selection`,
		);
		assert.notEqual(
			cell.background,
			outside.background,
			`${cell.date} visible selection`,
		);
		assert.notEqual(cell.background, "rgba(0, 0, 0, 0)");
	}
	assert.notEqual(
		selected[0].background,
		selected[1].background,
		"distinct endpoint",
	);
	return cells;
}

export async function holdResponses(page) {
	const pending = [];
	let released = false;
	let active = 0;
	await page.route("**/_topcoat/runtime/shards/**", async (route) => {
		active++;
		try {
			const response = await route.fetch();
			if (!released) {
				let release;
				const ready = new Promise((resolve) => {
					release = resolve;
				});
				pending.push(release);
				await ready;
			}
			// Requests superseded by another intent can already be canceled.
			await route.fulfill({ response }).catch(() => {});
		} finally {
			active--;
		}
	});
	return {
		async wait(count = 1) {
			await eventually(() => pending.length >= count, "server response held");
		},
		async release() {
			released = true;
			await page.unroute("**/_topcoat/runtime/shards/**");
			for (const resume of pending.reverse()) resume();
			await eventually(() => active === 0, "held requests released");
		},
	};
}
