// Review regressions drive compiled Rust handlers and the native form/popover.
import assert from "node:assert/strict";
import {
	active,
	day,
	holdResponses,
	input,
	open,
	picker,
	range,
	settled,
	trigger,
	validity,
} from "./calendar.helpers.mjs";

export function reviewRegressions(test) {
	test("opening response respects a newer text-input focus owner", async (page) => {
		const held = await holdResponses(page);
		await page.locator(trigger(picker)).focus();
		await page.keyboard.press("Enter");
		await held.wait();
		await page.keyboard.press("Shift+Tab");
		const id = await page.locator(input).getAttribute("id");
		assert.equal(await page.evaluate(() => document.activeElement.id), id);
		await held.release();
		await settled(page);
		assert.equal(await page.evaluate(() => document.activeElement.id), id);
		assert.equal(
			await page
				.locator(`${picker} [popover]`)
				.evaluate((panel) => panel.matches(":popover-open")),
			true,
		);
		await page.keyboard.press("Escape");
		await open(page);
	});

	test("same-task opening and input focus do not rearm deferred focus", async (page) => {
		await page.locator(trigger(picker)).focus();
		const held = await holdResponses(page);
		await page.locator(picker).evaluate((root) => {
			root.querySelector("button[popovertarget]").click();
			root.querySelector("input").focus();
		});
		await held.wait();
		await held.release();
		await settled(page);
		assert.equal(
			await page
				.locator(input)
				.evaluate((field) => document.activeElement === field),
			true,
		);
		assert.equal(
			await page
				.locator(`${picker} [popover]`)
				.evaluate((panel) => panel.matches(":popover-open")),
			true,
		);
	});

	for (const [root, selected, moved] of [
		["#inline-calendar", "2024-01-31", "2024-01-30"],
		[range, "2024-01-15", "2024-01-14"],
	]) {
		test(`selection then ArrowLeft preserves newer focus in ${root}`, async (page) => {
			if (root === range) await open(page, range);
			await page.locator(day(root, selected)).focus();
			const held = await holdResponses(page);
			await page.keyboard.press("Enter");
			await held.wait();
			await page.keyboard.press("ArrowLeft");
			await held.release();
			await settled(page, root);
			await active(page, moved);
			assert.equal(
				await page
					.locator(`${root} [data-date][tabindex="0"]`)
					.getAttribute("data-date"),
				moved,
			);
			assert.equal(
				await page.locator(day(root, selected)).getAttribute("data-selected"),
				"true",
			);
			await page.keyboard.press("ArrowRight");
			await active(page, selected);
		});
	}

	test("same-task reset then Clear preserves the newer empty draft", async (page) => {
		await page.locator(input).fill("2024-03-15");
		await validity(page, input, true);
		await page
			.getByRole("button", { name: "Clear", exact: true })
			.first()
			.evaluate((button) => {
				button
					.closest("[data-date-picker]")
					.querySelector("input")
					.form.reset();
				button.click();
			});
		// Cross the native post-dispatch task before checking authoritative validity.
		await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
		await validity(page, input, false);
		assert.equal(await page.locator(input).inputValue(), "");
	});

	test("same-task reset then application write preserves the newer date", async (page) => {
		await page.locator(input).fill("2024-03-15");
		await validity(page, input, true);
		await page.locator("#app-date").evaluate((button) => {
			button.form.reset();
			button.click();
		});
		await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
		await validity(page, input, true);
		assert.equal(await page.locator(input).inputValue(), "2024-04-20");
	});

	test("same-task reset then calendar selection preserves the newer date", async (page) => {
		await page.locator(input).fill("2024-03-15");
		await validity(page, input, true);
		await open(page, picker, "2024-03-15");
		await page.locator(day(picker, "2024-03-20")).evaluate((button) => {
			button.closest("[data-date-picker]").querySelector("input").form.reset();
			button.click();
		});
		await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
		await validity(page, input, true);
		assert.equal(await page.locator(input).inputValue(), "2024-03-20");
	});

	test("same-task application write then reset preserves the newer reset", async (page) => {
		await page.locator("#app-date").evaluate((button) => {
			button.click();
			button.form.reset();
		});
		await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
		await validity(page, input, true);
		assert.equal(await page.locator(input).inputValue(), "2024-01-31");
	});

	test("rendered picker and closed-popup responses have bounded payloads", async (page) => {
		const size = await page
			.locator(picker)
			.evaluate((root) => new TextEncoder().encode(root.outerHTML).length);
		const cell = await page
			.locator(day(picker, "2024-01-31"))
			.evaluate((day) => new TextEncoder().encode(day.outerHTML).length);
		const pending = [];
		page.on("request", (request) => {
			if (request.url().includes("/_topcoat/runtime/shards/"))
				pending.push(request.response().then((response) => response.body()));
		});
		await page.locator(input).fill("2024-03-15");
		await validity(page, input, true);
		await settled(page);
		await page.waitForLoadState("networkidle");
		const responses = await Promise.all(pending);
		assert(
			responses.length >= 2,
			"manual edits exercise both server validation and calendar rendering",
		);
		console.log(
			JSON.stringify({
				pickerBytes: size,
				dayBytes: cell,
				responseBytes: responses.map((body) => body.length),
			}),
		);
		// Uncompressed bounds keep one field below half a megabyte and one day
		// below 8KiB. They allow markup growth but catch whole-state duplication.
		assert(size <= 512 * 1024, "picker payload stays below 512KiB");
		assert(cell <= 8 * 1024, "one day stays below 8KiB");
		assert(
			responses.every((body) => body.length <= 512 * 1024),
			"each response stays below 512KiB",
		);
	});
}
