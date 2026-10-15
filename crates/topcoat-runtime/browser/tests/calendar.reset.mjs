// Reset ordering is exercised through compiled application handlers and native forms.
import assert from "node:assert/strict";
import { input, origin, range, validity } from "./calendar.helpers.mjs";

async function afterReset(page) {
	await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
	await page.waitForLoadState("networkidle");
}

async function singleValue(page, expected) {
	await afterReset(page);
	assert.equal(await page.locator("#single-value").textContent(), expected);
	assert.equal(await page.locator(input).inputValue(), expected);
	assert.equal(
		await page
			.locator("#dates-form")
			.evaluate((form) => new FormData(form).get("single")),
		expected,
	);
	await validity(page, input, true);
}

// Hold only the task scheduled synchronously by reset, so replacement can finish
// before the real owned callback is released. No signals or effects are intercepted.
async function holdReset(page, canceledSuccessor) {
	await page.locator("#ordering-form").evaluate((form, canceledSuccessor) => {
		const original = window.setTimeout;
		window.resetCompletions = [];
		window.setTimeout = (callback, delay, ...args) => {
			if (delay !== 0) return original(callback, delay, ...args);
			const id = original(() => {}, 60000);
			window.resetCompletions.push(() => {
				clearTimeout(id);
				callback(...args);
			});
			return id;
		};
		try {
			form.reset();
			if (canceledSuccessor) {
				form.addEventListener("reset", (event) => event.preventDefault(), {
					once: true,
				});
				form.reset();
			}
		} finally {
			window.setTimeout = original;
		}
	}, canceledSuccessor);
	assert.equal(
		await page.evaluate(() => window.resetCompletions.length),
		canceledSuccessor ? 2 : 1,
	);
}

async function editBoth(page) {
	await page.locator(input).fill("2024-03-15");
	await validity(page, input, true);
	await page.locator(`${range} input[name=start]`).fill("2024-03-15");
	await page.locator(`${range} input[name=end]`).fill("2024-03-18");
	await validity(page, `${range} input[name=end]`, true);
}

async function bothValues(page, expected) {
	await afterReset(page);
	const actual = await page.locator("#dates-form").evaluate((form) => {
		const names = ["single", "start", "end"];
		const data = new FormData(form);
		return {
			signals: ["single-value", "range-start-value", "range-end-value"].map(
				(id) => document.getElementById(id).textContent,
			),
			inputs: names.map((name) => form.elements.namedItem(name).value),
			submitted: names.map((name) => data.get(name)),
		};
	});
	assert.deepEqual(
		actual.signals,
		expected,
		"caller signals match the last uncanceled intent",
	);
	assert.deepEqual(
		actual.inputs,
		expected,
		"native fields match caller signals",
	);
	assert.deepEqual(
		actual.submitted,
		expected,
		"FormData matches caller signals",
	);
	await validity(page, input, true);
	await validity(page, `${range} input[name=end]`, true);
}

export function resetRegressions(test) {
	for (const action of ["app-same-date", "app-roundtrip-date"]) {
		for (const order of ["reset then write", "write then reset"]) {
			test(`${order} orders ${action} by committed writes`, async (page) => {
				await page.locator(input).fill("2024-03-15");
				await validity(page, input, true);
				await page.locator(`#${action}`).evaluate((button, order) => {
					if (order === "reset then write") {
						button.form.reset();
						button.click();
					} else {
						button.click();
						button.form.reset();
					}
				}, order);
				await singleValue(
					page,
					order === "reset then write" ? "2024-03-15" : "2024-01-31",
				);
			});
		}

		test(`native reset preserves a later ${action} listener`, async (page) => {
			await page.locator(input).fill("2024-03-15");
			await validity(page, input, true);
			await page.locator(`#${action}`).evaluate((button) => {
				button.form.addEventListener("reset", () => button.click(), {
					once: true,
				});
			});
			await page.locator("#reset-form").click();
			await singleValue(page, "2024-03-15");
		});
	}

	for (const action of ["app-same-range", "app-roundtrip-range"]) {
		for (const native of [false, true]) {
			test(`${native ? "native" : "scripted"} reset preserves the atomic range after ${action}`, async (page) => {
				await page.locator(`${range} input[name=start]`).fill("2024-03-15");
				await page.locator(`${range} input[name=end]`).fill("2024-03-18");
				await validity(page, `${range} input[name=end]`, true);
				if (native) {
					await page.locator(`#${action}`).evaluate((button) => {
						button.form.addEventListener("reset", () => button.click(), {
							once: true,
						});
					});
					await page.locator("#reset-form").click();
				} else {
					await page.locator(`#${action}`).evaluate((button) => {
						button.form.reset();
						button.click();
					});
				}
				await afterReset(page);
				assert.equal(
					await page.locator("#range-start-value").textContent(),
					"2024-03-15",
				);
				assert.equal(
					await page.locator("#range-end-value").textContent(),
					"2024-03-18",
				);
				assert.equal(
					await page.locator(`${range} input[name=start]`).inputValue(),
					"2024-03-15",
				);
				assert.equal(
					await page.locator(`${range} input[name=end]`).inputValue(),
					"2024-03-18",
				);
				assert.deepEqual(
					await page.locator("#dates-form").evaluate((form) => {
						const data = new FormData(form);
						return [data.get("start"), data.get("end")];
					}),
					["2024-03-15", "2024-03-18"],
				);
				await validity(page, `${range} input[name=end]`, true);
			});
		}
	}

	test("repeated resets retain the latest ordering checkpoint", async (page) => {
		await page.locator(input).fill("2024-03-15");
		await validity(page, input, true);
		await page.locator("#app-same-date").evaluate((button) => {
			button.form.reset();
			button.click();
			button.form.reset();
		});
		await singleValue(page, "2024-01-31");
		await page.locator(input).fill("2024-03-15");
		await validity(page, input, true);
		await page.locator("#app-roundtrip-date").evaluate((button) => {
			button.form.reset();
			button.form.reset();
			button.click();
		});
		await singleValue(page, "2024-03-15");
	});

	test("a reset listener adds no dependency to the dispatching effect", async (page) => {
		await page.goto(`${origin}/calendar-reset-tests`);
		await page.waitForLoadState("networkidle");
		assert.equal(await page.locator("#effect-runs").textContent(), "1");
		await page.locator("#effect-reset").click();
		await afterReset(page);
		assert.equal(
			await page.locator("#first-value").textContent(),
			"2024-01-31",
		);
		assert.equal(await page.locator("#effect-runs").textContent(), "2");
		await page.locator("#same-first").click();
		await afterReset(page);
		assert.equal(await page.locator("#effect-runs").textContent(), "2");
		await page.locator("#change-first").click();
		await afterReset(page);
		assert.equal(
			await page.locator("#first-value").textContent(),
			"2024-04-20",
		);
		assert.equal(
			await page.locator("#ordering-picker input").inputValue(),
			"2024-04-20",
		);
		assert.equal(await page.locator("#effect-runs").textContent(), "2");
	});

	for (const canceledFirst of [false, true]) {
		test(`${canceledFirst ? "canceled then accepted" : "accepted then canceled"} reset preserves single and range defaults`, async (page) => {
			await editBoth(page);
			await page.locator("#dates-form").evaluate((form, canceledFirst) => {
				const cancelNext = () =>
					form.addEventListener("reset", (event) => event.preventDefault(), {
						once: true,
					});
				if (canceledFirst) cancelNext();
				form.reset();
				if (!canceledFirst) cancelNext();
				form.reset();
			}, canceledFirst);
			await bothValues(page, ["2024-01-31", "", ""]);
		});
	}

	for (const action of [
		"app-same-date",
		"app-roundtrip-date",
		"app-same-range",
		"app-roundtrip-range",
	]) {
		test(`a canceled successor preserves later ${action} intent`, async (page) => {
			await editBoth(page);
			await page.locator(`#${action}`).evaluate((button) => {
				button.form.reset();
				button.click();
				button.form.addEventListener(
					"reset",
					(event) => event.preventDefault(),
					{ once: true },
				);
				button.form.reset();
			});
			await bothValues(
				page,
				action.endsWith("date")
					? ["2024-03-15", "", ""]
					: ["2024-01-31", "2024-03-15", "2024-03-18"],
			);
		});
	}

	for (const change of ["switch-controller", "remove-owner"]) {
		for (const canceledSuccessor of [false, true]) {
			test(`${change} discards the old reset completion${canceledSuccessor ? " after a canceled successor" : ""}`, async (page) => {
				await page.goto(`${origin}/calendar-reset-tests`);
				await page.waitForLoadState("networkidle");
				await holdReset(page, canceledSuccessor);
				await page.locator(`#${change}`).click();
				if (change === "switch-controller") {
					await page
						.locator('#reset-owner[data-controller="second"]')
						.waitFor();
					assert.equal(
						await page.locator("#reset-owner").getAttribute("data-controller"),
						"second",
					);
				} else {
					await page.locator("#ordering-picker").waitFor({ state: "detached" });
					assert.equal(await page.locator("#ordering-picker").count(), 0);
				}
				await page.evaluate(() => {
					for (const complete of window.resetCompletions) complete();
				});
				await afterReset(page);
				assert.equal(
					await page.locator("#first-value").textContent(),
					"2024-03-15",
				);
				assert.equal(
					await page.locator("#second-value").textContent(),
					"2024-03-15",
				);
				if (change === "remove-owner") {
					await page.locator("#remove-owner").click();
					await page.locator("#ordering-picker input").waitFor();
				}
				assert.equal(
					await page.locator("#ordering-picker input").inputValue(),
					"2024-03-15",
				);
				await page.locator("#native-reset").click();
				await afterReset(page);
				assert.equal(
					await page.locator("#ordering-picker input").inputValue(),
					"2024-01-31",
				);
				const owner = change === "switch-controller" ? "second" : "first";
				const other = owner === "second" ? "first" : "second";
				assert.equal(
					await page.locator(`#${owner}-value`).textContent(),
					"2024-01-31",
				);
				assert.equal(
					await page.locator(`#${other}-value`).textContent(),
					"2024-03-15",
				);
				assert.equal(
					await page
						.locator("#ordering-form")
						.evaluate((form) => new FormData(form).get("ordered")),
					"2024-01-31",
				);
			});
		}
	}
}
