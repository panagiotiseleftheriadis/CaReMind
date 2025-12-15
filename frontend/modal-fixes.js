// modal-fixes.js
class ModalManager {
    constructor() {
        this.init();
    }

    init() {
        this.setupModalCloseHandlers();
        this.setupGlobalClickHandlers();
    }

    setupModalCloseHandlers() {
        document.addEventListener('click', (e) => {
            // Close modal με X button
            if (e.target.classList.contains('close')) {
                this.closeModal(e.target.closest('.modal'));
            }
            // Close modal με Ακύρωση button
            if (e.target.textContent === 'Ακύρωση' && e.target.classList.contains('btn-secondary')) {
                const modal = e.target.closest('.modal');
                if (modal) this.closeModal(modal);
            }
        });
    }

    setupGlobalClickHandlers() {
        // Close modal όταν κλικάρεις έξω από το content
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                this.closeModal(e.target);
            }
        });

        // Close modal με ESC key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeAllModals();
            }
        });
    }

    closeModal(modal) {
        if (modal) {
            modal.style.display = 'none';
            // Reset form
            const form = modal.querySelector('form');
            if (form) form.reset();
        }
    }

    closeAllModals() {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.style.display = 'none';
        });
    }
}

const modalManager = new ModalManager();