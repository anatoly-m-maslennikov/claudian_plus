import { type App, Modal, Setting } from 'obsidian';

export function promptText(
  app: App,
  title: string,
  initialText: string,
  placeholder?: string,
): Promise<string | null> {
  return new Promise(resolve => {
    new TextPromptModal(app, title, initialText, placeholder, resolve).open();
  });
}

class TextPromptModal extends Modal {
  private value: string;
  private resolved = false;

  constructor(
    app: App,
    title: string,
    initialText: string,
    private readonly placeholder: string | undefined,
    private readonly resolve: (value: string | null) => void,
  ) {
    super(app);
    this.setTitle(title);
    this.value = initialText;
  }

  onOpen() {
    this.modalEl.addClass('claudian-text-prompt-modal');

    let inputEl: HTMLInputElement;

    new Setting(this.contentEl)
      .addText(text => {
        text
          .setValue(this.value)
          .setPlaceholder(this.placeholder ?? '')
          .onChange(val => {
            this.value = val;
          });
        inputEl = text.inputEl;
      });

    new Setting(this.contentEl)
      .addButton(btn =>
        btn
          .setButtonText('Cancel')
          .onClick(() => this.close()),
      )
      .addButton(btn =>
        btn
          .setButtonText('Rename')
          .setCta()
          .onClick(() => {
            this.resolved = true;
            this.resolve(this.value.trim() || null);
            this.close();
          }),
      );

    if (inputEl!) {
      inputEl.focus();
      inputEl.select();
      inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.resolved = true;
          this.resolve(this.value.trim() || null);
          this.close();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          this.close();
        }
      });
    }
  }

  onClose() {
    if (!this.resolved) {
      this.resolve(null);
    }
    this.contentEl.empty();
  }
}
