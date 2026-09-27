const { test, expect } = require('@playwright/test');
const { gotoApp, seed, blankState, today } = require('./helpers');

// id, German label, published GI, source type, exact source item identifier.
const expectedFoods = [
  ['weissbrot', 'Weißbrot', 75, 'review_mean', 'Tabelle 1: White wheat bread'],
  ['vollkornbrot', 'Vollkornbrot', 74, 'review_mean', 'Tabelle 1: Whole wheat/whole meal bread'],
  ['haferbrei', 'Haferbrei aus Haferflocken', 55, 'review_mean', 'Tabelle 1: Porridge, rolled oats'],
  ['instant-haferbrei', 'Instant-Haferbrei', 79, 'review_mean', 'Tabelle 1: Instant oat porridge'],
  ['muesli', 'Müsli', 57, 'review_mean', 'Tabelle 1: Muesli'],
  ['cornflakes', 'Cornflakes', 81, 'review_mean', 'Tabelle 1: Cornflakes'],
  ['weisser-reis', 'Weißer Reis', 73, 'review_mean', 'Tabelle 1: White rice, boiled'],
  ['vollkornreis', 'Vollkornreis', 68, 'review_mean', 'Tabelle 1: Brown rice, boiled'],
  ['gerste', 'Gerste', 28, 'review_mean', 'Tabelle 1: Barley'],
  ['spaghetti-weiss', 'Spaghetti, weiß', 49, 'review_mean', 'Tabelle 1: Spaghetti, white'],
  ['spaghetti-vollkorn', 'Spaghetti, Vollkorn', 48, 'review_mean', 'Tabelle 1: Spaghetti, whole meal'],
  ['couscous', 'Couscous', 65, 'review_mean', 'Tabelle 1: Couscous'],
  ['kartoffeln-gekocht', 'Kartoffeln, gekocht', 78, 'review_mean', 'Tabelle 1: Potato, boiled'],
  ['kartoffelpueree-instant', 'Kartoffelpüree, instant', 87, 'review_mean', 'Tabelle 1: Potato, instant mash'],
  ['suesskartoffel', 'Süßkartoffel', 63, 'review_mean', 'Tabelle 1: Sweet potato, boiled'],
  ['karotten', 'Karotten', 39, 'review_mean', 'Tabelle 1: Carrots, boiled'],
  ['zuckermais', 'Zuckermais', 52, 'review_mean', 'Tabelle 1: Sweet corn'],
  ['apfel', 'Apfel', 36, 'review_mean', 'Tabelle 1: Apple, raw'],
  ['orange', 'Orange', 43, 'review_mean', 'Tabelle 1: Orange, raw'],
  ['banane', 'Banane', 51, 'review_mean', 'Tabelle 1: Banana, raw'],
  ['ananas', 'Ananas', 59, 'review_mean', 'Tabelle 1: Pineapple, raw'],
  ['wassermelone', 'Wassermelone', 76, 'review_mean', 'Tabelle 1: Watermelon, raw'],
  ['vollmilch', 'Vollmilch', 39, 'review_mean', 'Tabelle 1: Milk, full fat'],
  ['magermilch', 'Magermilch', 37, 'review_mean', 'Tabelle 1: Milk, skim'],
  ['fruchtjoghurt', 'Fruchtjoghurt', 41, 'review_mean', 'Tabelle 1: Yogurt, fruit'],
  ['kichererbsen', 'Kichererbsen', 28, 'review_mean', 'Tabelle 1: Chickpeas'],
  ['linsen', 'Linsen', 32, 'review_mean', 'Tabelle 1: Lentils'],
  ['kidneybohnen', 'Kidneybohnen', 24, 'review_mean', 'Tabelle 1: Kidney beans'],
  ['speiseeis', 'Speiseeis', 51, 'review_mean', 'Tabelle 1: Ice cream'],
  ['schokolade', 'Schokolade', 40, 'review_mean', 'Tabelle 1: Chocolate'],
  ['ditsch-brezel', 'Laugenbrezel, Ditsch', 80, 'tested_product', 'Supplementtabelle 1, Nr. 209; Originalstudie Ref. 34'],
  ['paderborner-lieken', 'Paderborner, Lieken Urkorn', 62, 'tested_product', 'Supplementtabelle 1, Nr. 218; Originalstudie Ref. 34'],
  ['kraftkerni-lieken', 'Kraftkerni, Lieken Urkorn', 55, 'tested_product', 'Supplementtabelle 1, Nr. 224; Originalstudie Ref. 34'],
];

async function openGuide(page, state = blankState()) {
  await gotoApp(page);
  await seed(page, state);
  await page.locator('#carbCalcOpen').click();
  await page.locator('#giGuideOpen').click();
  await expect(page.locator('#v-gi')).toBeVisible();
}

test.describe('Bundled GI food guide', () => {
  test('opens from the calculator, keeps seven primary tabs, and returns to the dated calculator', async ({ page }) => {
    await openGuide(page);
    await expect(page.locator('nav button[data-tab]')).toHaveCount(7);
    await expect(page.locator('#giSearch')).toBeFocused();
    await page.locator('#giToCalc').click();
    await expect(page.locator('#carbCalc')).toBeVisible();
    await expect(page.locator('#carbCalcDate')).toContainText('KH berechnen für');
    await page.locator('#carbCalcClose').click();
    await page.locator('#carbCalcOpen').click();
    await page.locator('#giGuideOpen').click();
    await page.locator('#giBack').click();
    await expect(page.locator('#v-day')).toBeVisible();
  });

  test('contains 33 approved sourced records and derives exact class boundaries', async ({ page }) => {
    await openGuide(page);
    const records = await page.evaluate(() => GI_FOODS.map(food => ({ ...food, classification: giClass(food.gi) })));
    expect(expectedFoods).toHaveLength(33);
    expect(records.map(({ id, displayName, gi, sourceType, sourceIdentifier }) =>
      [id, displayName, gi, sourceType, sourceIdentifier]).sort((a, b) => a[0].localeCompare(b[0])))
      .toEqual([...expectedFoods].sort((a, b) => a[0].localeCompare(b[0])));
    expect(new Set(records.map(food => food.id)).size).toBe(records.length);
    for (const food of records) {
      expect(Number.isInteger(food.gi) && food.gi > 0, food.displayName).toBe(true);
      expect(['review_mean', 'tested_product']).toContain(food.sourceType);
      for (const key of ['displayName', 'category', 'sourceLabel', 'sourceIdentifier', 'pmid', 'doi'])
        expect(food[key], `${food.displayName}: ${key}`).toBeTruthy();
      expect(food.sourceIdentifier).not.toMatch(/\bUO\d*\b/);
      expect(food.classification).toBe(food.gi <= 55 ? 'Niedrig' : food.gi <= 69 ? 'Mittel' : 'Hoch');
      expect([food.sourceLabel, food.sourceYear, food.pmid, food.doi]).toEqual(food.sourceType === 'review_mean' ?
        ['Atkinson et al. 2008', 2008, '18835944', '10.2337/dc08-1239'] :
        ['Atkinson et al. 2021', 2021, '34258626', '10.1093/ajcn/nqab233']);
      if (food.sourceType === 'tested_product') {
        expect(food.originalPmid).toBe('26931667');
        expect(food.originalDoi).toBe('10.1038/ejcn.2016.9');
      }
    }
    expect(await page.evaluate(() => [55, 56, 69, 70].map(giClass))).toEqual(['Niedrig', 'Mittel', 'Mittel', 'Hoch']);
    expect(records.some(food => /Fleisch|Fisch|Ei|Öl|Hartkäse/.test(food.displayName))).toBe(false);
    expect(await page.locator('#giCategory option').allTextContents()).not.toContain('Getränke');
  });

  test('search is immediate, case-insensitive and umlaut-friendly', async ({ page }) => {
    await openGuide(page);
    const search = page.locator('#giSearch');
    await search.fill('KARTOFFEL');
    await expect(page.locator('.gi-item')).toHaveCount(3);
    await expect(page.locator('[data-gi-id="suesskartoffel"]')).toBeVisible();
    for (const spelling of ['Müsli', 'müsli', 'musli', 'muesli']) {
      await search.fill(spelling);
      await expect(page.locator('.gi-item')).toHaveCount(1);
      await expect(page.locator('.gi-item')).toContainText('Müsli');
    }
    await search.fill('HAfer');
    await expect(page.locator('.gi-item')).toHaveCount(2);
    await search.fill('unbekanntes Lebensmittel');
    await expect(page.locator('#giResults')).toContainText('Keine passenden Lebensmittel');
    await search.clear();
    await expect(page.locator('.gi-item')).toHaveCount(33);
  });

  test('category and GI filters combine without empty categories', async ({ page }) => {
    await openGuide(page);
    await page.locator('#giCategory').selectOption('Reis');
    await expect(page.locator('.gi-item')).toHaveCount(2);
    await page.locator('[data-gi-level="Hoch"]').click();
    await expect(page.locator('.gi-item')).toHaveCount(1);
    await expect(page.locator('.gi-item')).toContainText('Weißer Reis');
    await page.locator('[data-gi-level="Mittel"]').click();
    await expect(page.locator('.gi-item')).toHaveCount(1);
    await expect(page.locator('.gi-item')).toContainText('Vollkornreis');
    await page.locator('[data-gi-level="Niedrig"]').click();
    await expect(page.locator('.gi-item')).toHaveCount(0);
    await page.locator('#giCategory').selectOption('all');
    await expect(page.locator('.gi-item')).not.toHaveCount(0);
    await expect(page.locator('[data-gi-level="Niedrig"]')).toHaveAttribute('aria-pressed', 'true');
  });

  test('defaults to name order and numeric sorting is factual', async ({ page }) => {
    await openGuide(page);
    const names = await page.locator('.gi-food strong').allTextContents();
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'de')));
    await page.locator('#giSort').selectOption('low');
    const ascending = await page.locator('.gi-value').allTextContents();
    expect(ascending.map(text => Number(text.replace('GI ', '')))).toEqual(
      [...ascending].map(text => Number(text.replace('GI ', ''))).sort((a, b) => a - b));
    await page.locator('#giSort').selectOption('high');
    const descending = await page.locator('.gi-value').allTextContents();
    expect(descending.map(text => Number(text.replace('GI ', '')))).toEqual(
      [...descending].map(text => Number(text.replace('GI ', ''))).sort((a, b) => b - a));
  });

  test('source details distinguish a review mean from a precisely tested product', async ({ page }) => {
    await openGuide(page);
    const mean = page.locator('[data-gi-id="kartoffeln-gekocht"]');
    await expect(mean).toContainText('GI 78');
    await expect(mean).toContainText('Hoch');
    await expect(mean).toContainText('Produkte, Sorte und Zubereitung können deutlich abweichen');
    await mean.locator('summary').click();
    await expect(mean).toContainText('Mittelwert aus mehreren Studien');
    await expect(mean).toContainText('PMID 18835944 · DOI 10.2337/dc08-1239');
    await expect(mean).not.toContainText('74–82');
    const product = page.locator('[data-gi-id="ditsch-brezel"]');
    await product.locator('summary').click();
    await expect(product).toContainText('getesteten Produkts');
    await expect(product).toContainText('Originalstudie Ref. 34');
    await expect(product).toContainText('10.1038/ejcn.2016.9');
  });

  test('educational wording keeps GI separate from carbs and medical interpretation', async ({ page }) => {
    await openGuide(page);
    const guide = page.locator('#v-gi');
    await expect(guide).toContainText('Ein niedriger GI bedeutet nicht automatisch wenig Kohlenhydrate oder keto-geeignet.');
    await expect(guide).toContainText('Glukose = 100');
    await expect(guide).toContainText('nicht sinnvoll anwendbar');
    await expect(guide).not.toContainText(/Ketose|gesund|ungesund|glykämische Last|beste Lebensmittel/i);
  });

  test('guide browsing leaves calculator, state, storage and all exports isolated', async ({ page }) => {
    const state = blankState({ days: { [today()]: { c: 12, plan: 't' } } });
    await gotoApp(page);
    await seed(page, state);
    const before = await page.evaluate(() => ({ state: JSON.stringify(S), stored: localStorage.getItem(KEY) }));
    await page.locator('#carbCalcOpen').click();
    await page.locator('#giGuideOpen').click();
    await page.locator('#giSearch').fill('Kartoffel');
    await page.locator('[data-gi-level="Hoch"]').click();
    const after = await page.evaluate(() => ({ state: JSON.stringify(S), stored: localStorage.getItem(KEY),
      day: S.days[today()], report: reportHTML(), sheet: sheetHTML(1, true),
      archive: JSON.stringify(S.archive) }));
    expect(after.state).toBe(before.state);
    expect(after.stored).toBe(before.stored);
    expect(after.day).toEqual({ c: 12, plan: 't' });
    await page.locator('nav button[data-tab="set"]').click();
    const [backup] = await Promise.all([page.waitForEvent('download'), page.locator('#exp').click()]);
    const backupChunks = [];
    for await (const chunk of await backup.createReadStream()) backupChunks.push(chunk);
    const [csv] = await Promise.all([page.waitForEvent('download'), page.locator('#csv').click()]);
    const csvChunks = [];
    for await (const chunk of await csv.createReadStream()) csvChunks.push(chunk);
    const outputs = [after.state, after.stored, after.report, after.sheet, after.archive,
      Buffer.concat(backupChunks).toString(), Buffer.concat(csvChunks).toString()];
    for (const [id, displayName] of expectedFoods) {
      for (const output of outputs) {
        expect(output, `${id} must stay outside user data and exports`).not.toContain(id);
        expect(output, `${displayName} must stay outside user data and exports`).not.toContain(displayName);
      }
    }
    expect(await page.evaluate(() => DATA_VERSION)).toBe(7);
  });

  test('search and filters make no third-party request', async ({ page, context, baseURL }) => {
    const requests = [];
    context.on('request', request => requests.push(request.url()));
    await openGuide(page);
    await page.locator('#giSearch').fill('Reis');
    await page.locator('#giCategory').selectOption('Reis');
    await page.locator('[data-gi-level="Hoch"]').click();
    await page.waitForLoadState('networkidle');
    const origin = new URL(baseURL).origin;
    expect(requests.filter(url => /^https?:/.test(url) && new URL(url).origin !== origin)).toEqual([]);
  });

  test('search, filter and source disclosure work with keyboard', async ({ page }) => {
    await openGuide(page);
    await page.keyboard.type('Apfel');
    await expect(page.locator('.gi-item')).toHaveCount(1);
    const low = page.locator('[data-gi-level="Niedrig"]');
    await low.focus();
    await page.keyboard.press('Enter');
    await expect(low).toHaveAttribute('aria-pressed', 'true');
    const summary = page.locator('.gi-item summary');
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.gi-item details')).toHaveAttribute('open', '');
    await expect(page.locator('.gi-item')).toContainText('Tabelle 1: Apple, raw');
  });
});
