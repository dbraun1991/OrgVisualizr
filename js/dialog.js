/**
 * Provides dialog management actions for alert, confirm, and prompt modals.
 * Relies on shared state (`dialogOpen`, `dialogMode`, `_dialogResolve`, etc.)
 * to handle asynchronous dialog flows using Promises.
 */
export const dialogActions = {
    /**
     * Handles the Escape key press to dismiss the topmost open modal.
     */
    onEscapeModal() {
        if (this.dialogOpen) this.dialogDismiss();
        else if (this.importModalOpen) this.importModalOpen = false;
        else if (this.manageFilesModalOpen) this.manageFilesModalOpen = false;
    },

    /**
     * Confirms the current dialog, resolving the pending promise with the corresponding positive value.
     */
    dialogConfirmOk() {
        const r = this._dialogResolve;
        this._dialogResolve = null;
        this.dialogOpen = false;

        if (!r) return;

        if (this.dialogMode === 'alert') r();
        else if (this.dialogMode === 'confirm') r(true);
        else if (this.dialogMode === 'prompt') r(this.dialogInput);
    },

    /**
     * Dismisses the current dialog, resolving the pending promise with a default/negative value.
     */
    dialogDismiss() {
        const r = this._dialogResolve;
        this._dialogResolve = null;
        this.dialogOpen = false;

        if (!r) return;

        if (this.dialogMode === 'alert') r();
        else if (this.dialogMode === 'confirm') r(false);
        else if (this.dialogMode === 'prompt') r(null);
    },

    /**
     * Displays an alert dialog.
     *
     * @param {string} message - The message to display.
     * @param {string} [title='Note'] - The dialog title.
     * @returns {Promise<void>} Resolves when the dialog is dismissed or confirmed.
     */
    dialogAlert(message, title = 'Note') {
        return new Promise((resolve) => {
            this.dialogMode = 'alert';
            this.dialogTitle = title;
            this.dialogMessage = message;
            this.dialogInput = '';
            this._dialogResolve = resolve;
            this.dialogOpen = true;
        });
    },

    /**
     * Displays a confirmation dialog.
     *
     * @param {string} message - The message to display.
     * @param {string} [title='Confirm'] - The dialog title.
     * @returns {Promise<boolean>} Resolves to true if confirmed, false if dismissed.
     */
    dialogConfirm(message, title = 'Confirm') {
        return new Promise((resolve) => {
            this.dialogMode = 'confirm';
            this.dialogTitle = title;
            this.dialogMessage = message;
            this.dialogInput = '';
            this._dialogResolve = resolve;
            this.dialogOpen = true;
        });
    },

    /**
     * Displays a prompt dialog for user input.
     *
     * @param {string} message - The message to display.
     * @param {string} [defaultValue=''] - The initial value for the input field.
     * @param {string} [title='Input'] - The dialog title.
     * @returns {Promise<string|null>} Resolves to the input string if confirmed, or null if dismissed.
     */
    dialogPrompt(message, defaultValue = '', title = 'Input') {
        return new Promise((resolve) => {
            this.dialogMode = 'prompt';
            this.dialogTitle = title;
            this.dialogMessage = message;
            this.dialogInput = defaultValue;
            this._dialogResolve = resolve;
            this.dialogOpen = true;
        });
    }
};
