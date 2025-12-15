// interest-form.js
class InterestForm {
  constructor() {
    // URL του Google Apps Script Web App
    this.googleAppsScriptURL =
      "https://script.google.com/macros/s/AKfycbxeit4jc-B4L9lkcvjTPULizNQBTrlT7A7nA6--2ct7k9GNEaU8v_dPEMBzS0bnwXtQ/exec";
  }

  init() {
    this.setupEventListeners();
  }

  setupEventListeners() {
    const interestForm = document.getElementById("interestForm");
    if (interestForm) {
      interestForm.addEventListener("submit", (e) => {
        e.preventDefault(); // 👉 ΣΤΑΜΑΤΑΕΙ το κανονικό submit
        this.submitForm();
      });
    }
  }

  async submitForm() {
    const submitBtn = document.getElementById("submitInterestBtn");
    const originalText = submitBtn.textContent;

    // Απενεργοποίηση κουμπιού κατά τη διάρκεια υποβολής
    submitBtn.disabled = true;
    submitBtn.textContent = "Αποστολή...";

    // Απόκρυψη προηγούμενων μηνυμάτων
    this.hideMessages();

    const formData = {
      fullName: document.getElementById("fullName").value.trim(),
      company: document.getElementById("company").value.trim(),
      email: document.getElementById("email").value.trim(),
      phone: document.getElementById("phone").value.trim(),
      city: document.getElementById("city").value.trim(),
      businessType: document.getElementById("businessType").value,
      vehicleCount: document.getElementById("vehicleCount").value,
      comments: document.getElementById("comments").value.trim(),
    };

    // Επικύρωση βασικών πεδίων
    if (!this.validateForm(formData)) {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
      return;
    }

    // Μετατροπή σε application/x-www-form-urlencoded για να μην έχουμε CORS preflight
    const formBody = new URLSearchParams(formData).toString();

    try {
      const response = await fetch(this.googleAppsScriptURL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
        },
        body: formBody,
      });

      const text = await response.text();
      let result = {};
      try {
        result = JSON.parse(text);
      } catch (e) {
        result = { success: response.ok };
      }

      if (result.success) {
        this.showSuccess();
        document.getElementById("interestForm").reset();
      } else {
        throw new Error(result.message || "Unknown error");
      }
    } catch (error) {
      console.error("Error:", error);
      this.showError();
    } finally {
      // Επανενεργοποίηση κουμπιού
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  }

  validateForm(formData) {
    if (
      !formData.fullName ||
      !formData.company ||
      !formData.email ||
      !formData.phone
    ) {
      alert("Παρακαλώ συμπληρώστε τα υποχρεωτικά πεδία");
      return false;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      alert("Παρακαλώ εισάγετε ένα έγκυρο email address");
      return false;
    }

    const phoneRegex = /^[0-9]{10,}$/;
    const cleanPhone = formData.phone.replace(/\s/g, "");
    if (!phoneRegex.test(cleanPhone)) {
      alert(
        "Παρακαλώ εισάγετε ένα έγκυρο αριθμό τηλεφώνου (τουλάχιστον 10 ψηφία)"
      );
      return false;
    }

    return true;
  }

  showSuccess() {
    const successMessage = document.getElementById("successMessage");
    successMessage.style.display = "block";

    setTimeout(() => {
      successMessage.style.display = "none";
    }, 8000);

    successMessage.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  showError() {
    const errorMessage = document.getElementById("errorMessage");
    errorMessage.style.display = "block";
    errorMessage.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  hideMessages() {
    document.getElementById("successMessage").style.display = "none";
    document.getElementById("errorMessage").style.display = "none";
  }

  setScriptURL(url) {
    this.googleAppsScriptURL = url;
  }
}

// 👉 ΕΔΩ είναι το σημαντικό που έλειπε: κάνουμε init όταν φορτώσει η σελίδα
const interestForm = new InterestForm();

document.addEventListener("DOMContentLoaded", () => {
  interestForm.init();
});
