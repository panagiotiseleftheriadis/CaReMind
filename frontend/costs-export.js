(function () {
  function csvField(value) {
    return String(value ?? "").replace(/"/g, '""').replace(/\r?\n/g, " ");
  }

  function exportCsv({ costs, vehicles, categoryLabel }) {
    const rows = [["Ημερομηνία", "Όχημα", "Κατηγορία", "Ποσό", "Περιγραφή", "Απόδειξη"]];

    costs.forEach((cost) => {
      const vehicle = vehicles.find((item) => item.id == cost.vehicleId);
      const date = new Date(cost.date);
      const dateText = Number.isNaN(date.getTime())
        ? ""
        : [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, "0"),
            String(date.getDate()).padStart(2, "0"),
          ].join("-");

      rows.push([
        dateText,
        vehicle ? `${vehicle.vehicleType} - ${vehicle.model || ""}` : "—",
        categoryLabel(cost.category),
        (Number(cost.amount) || 0).toFixed(2),
        cost.description || "",
        cost.receipt || cost.receiptNumber || "",
      ]);
    });

    const content = rows
      .map((row) => row.map((field) => `"${csvField(field)}"`).join(";"))
      .join("\n");
    const blob = new Blob(["\ufeff" + content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.hidden = true;
    link.href = url;
    link.download = `caremind-costs-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  window.CaReMindCostsExport = { exportCsv };
})();
