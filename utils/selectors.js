const SELECTORS = {
  auth: {
    email: 'input[type="email"]',
    password: 'input[type="password"]',
    submit: 'button[type="submit"]',
  },
  automation: {
    eventSelectTestId: 'automation-event-select',
    addActionButtonText: /\+\s*Добавить действие/i,
    sendMessageOptionText: /Отправить сообщение/i,
    saveButtonText: /Сохранить/i,
    oneTimeTypeText: /Однократно/i,
    titleInputCandidates: [
      'input[name="name"]',
      'input[placeholder*="Название"]',
      'input[placeholder*="назв"]',
      '[data-testid="automation-name-input"] input',
      '[data-testid="automation-name-input"]',
      'form input[type="text"]',
    ],
    successToastCandidates: [
      '[role="status"]',
      '[data-sonner-toast]',
      '.toast',
      '.notification',
    ],
    dropdownOverlay: 'div.absolute',
  },
};

module.exports = {
  SELECTORS,
};
