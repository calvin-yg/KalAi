/**
 * Parsing checks for the Open Food Facts integration. The live API is not
 * reachable from every environment, so the payload shapes are pinned here —
 * including the kilojoule-only case that most Australian labels produce.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { productFromOff, gramsFromPackSize, macrosForGrams, normaliseBarcode } from "../src/lib/products.ts";

const timTams = {
  status: 1,
  product: {
    code: "9310005107657",
    product_name: "Tim Tam Original",
    brands: "Arnott's",
    quantity: "200 g",
    serving_size: "2 biscuits (37 g)",
    serving_quantity: 37,
    nutriments: {
      "energy-kcal_100g": 496,
      proteins_100g: 4.7,
      carbohydrates_100g: 63.4,
      fat_100g: 24.5,
    },
  },
};

// Australian labels routinely carry kilojoules and no kcal field at all.
const kjOnly = {
  status: 1,
  product: {
    product_name: "Weet-Bix",
    brands: "Sanitarium",
    quantity: "1.12 kg",
    serving_size: "2 biscuits (30 g)",
    serving_quantity: 30,
    nutriments: { "energy-kj_100g": 1500, proteins_100g: 12, carbohydrates_100g: 67, fat_100g: 1.3 },
  },
};

test("reads a straightforward product", () => {
  const product = productFromOff(timTams, "9310005107657");
  assert.equal(product.name, "Tim Tam Original");
  assert.equal(product.brand, "Arnott's");
  assert.equal(product.servingGrams, 37);
  assert.deepEqual(product.per100g, { calories: 496, protein: 5, carbs: 63, fat: 25 });
});

test("converts kilojoule-only labels to calories", () => {
  const product = productFromOff(kjOnly, "9300675024235");
  // 1500 kJ / 4.184 = 358.5 kcal
  assert.equal(product.per100g.calories, 359);
});

test("returns null for an unknown barcode", () => {
  assert.equal(productFromOff({ status: 0 }, "0000000000000"), null);
});

test("returns null when the record carries no energy value", () => {
  const empty = { status: 1, product: { product_name: "Mystery", nutriments: {} } };
  assert.equal(productFromOff(empty, "1234567890123"), null);
});

test("scales macros to the portion actually eaten", () => {
  const product = productFromOff(timTams, "9310005107657");
  // Two biscuits: 37 g of a 496 kcal/100 g product.
  assert.deepEqual(macrosForGrams(product, 37), {
    calories: 184, protein: 2, carbs: 23, fat: 9,
  });
  assert.equal(macrosForGrams(product, 100).calories, 496);
});

test("reads pack sizes, including multipacks and litres", () => {
  assert.equal(gramsFromPackSize("200 g"), 200);
  assert.equal(gramsFromPackSize("1.12 kg"), 1120);
  assert.equal(gramsFromPackSize("375 mL"), 375);
  assert.equal(gramsFromPackSize("4 x 125 g"), 500);
  assert.equal(gramsFromPackSize("family size"), null);
});

test("accepts real barcode lengths and rejects noise", () => {
  assert.equal(normaliseBarcode("9310005107657"), "9310005107657");
  assert.equal(normaliseBarcode("93 100 051"), "93100051");
  assert.equal(normaliseBarcode("12345"), null);
  assert.equal(normaliseBarcode("not a barcode"), null);
});
