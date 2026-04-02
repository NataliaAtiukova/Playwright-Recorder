// Scenario: Создать сообщение в сценарии
// Generated from Playwright codegen. Edit if needed.
module.exports = async (page) => {
  page.setDefaultTimeout(12000);

  const buttonTitleInputs = () => page.getByRole('textbox', { name: 'Название кнопки' });
  const addButton = page.getByRole('button', { name: /\+\s*Добавить кнопку/i }).first();

  const waitForButtonInputCount = async (count) => {
    await buttonTitleInputs().nth(count - 1).waitFor({ state: 'visible', timeout: 12000 });
  };

  const selectButtonType = async (typeLocatorFactories) => {
    const factories = Array.isArray(typeLocatorFactories) ? typeLocatorFactories : [typeLocatorFactories];
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await addButton.scrollIntoViewIfNeeded();
        await addButton.click();

        for (const factory of factories) {
          const option = factory();
          if (await option.isVisible({ timeout: 1500 }).catch(() => false)) {
            await option.click();
            return;
          }
        }
      } catch (_) {
        // retry below
      }
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(350);
    }
    throw new Error('Не удалось выбрать тип кнопки после 3 попыток.');
  };

  await page.goto('https://testing.winwinbot.com/ru/chat/10/automation/schedules/36/messages');
  await page.getByRole('button', { name: 'Создать сообщение' }).click();
  await page.getByRole('textbox', { name: 'Введите название' }).click();
  await page.getByRole('textbox', { name: 'Введите название' }).fill('Старт - ветка Начать');
  await page.locator('.ql-editor').click();

  const emptyButtonsHint = page.getByText('Нет кнопок').nth(1);
  if (await emptyButtonsHint.isVisible().catch(() => false)) {
    await emptyButtonsHint.click();
  }

  await selectButtonType([
    () => page.getByText('При нажатии на такую кнопку подписчик получит следующее сообщение в текущем сцен').first(),
    () => page.getByText(/следующее сообщение сценария/i).first(),
  ]);
  await waitForButtonInputCount(1);
  await buttonTitleInputs().nth(0).fill('1️⃣ 💸 Как это работает');
  await page.waitForTimeout(250);

  await selectButtonType([
    () => page.getByText('При нажатии на такую кнопку подписчик получит следующее сообщение в текущем сцен').first(),
    () => page.getByText(/следующее сообщение сценария/i).first(),
  ]);
  await waitForButtonInputCount(2);
  await buttonTitleInputs().nth(1).fill('2️⃣ 📦 Хочу готовую схему');
  await page.waitForTimeout(250);

  await selectButtonType([
    () => page.locator('div').filter({ hasText: /^Кнопка с присвоением тега$/ }).first(),
    () => page.getByText(/Кнопка с присвоением тега/i).first(),
    () => page.getByText(/присвоением тега/i).first(),
  ]);
  await waitForButtonInputCount(3);
  await buttonTitleInputs().nth(2).fill('3️⃣ ❌ Не верю');

  await page.getByRole('textbox', { name: 'Выберите тег' }).click();
  await page.getByText('Создать тег').click();
  await page.locator('input[type="color"]').click();
  await page.locator('input[type="color"]').fill('#ff2929');
  await page.getByRole('textbox', { name: 'Название тега' }).fill('skeptic');
  await page.getByTestId('tag-save-button').click();
  await page.getByRole('button', { name: 'Сохранить' }).click();
  // ---------------------
};
