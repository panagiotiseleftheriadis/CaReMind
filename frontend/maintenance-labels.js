(function () {
  const statuses = {
    active: "Ενεργή",
    pending: "Σε εξέλιξη",
    upcoming: "Επικείμενη",
    overdue: "Καθυστερημένη",
    completed: "Ολοκληρωμένη",
  };
  const types = {
    oil: "Αλλαγή Λαδιών",
    service: "Γενικό Service",
    tires: "Αλλαγή Λάστιχων",
    brakes: "Φρένα",
    battery: "Μπαταρία",
    filters: "Φίλτρα",
    coolant: "Ψυκτικό Υγρό",
    transmission: "Κιβώτιο Ταχυτήτων",
    ac_service: "Service A/C",
    spark_plugs: "Μπουζί",
    timing_belt: "Ιμάντας Χρονισμού",
    alignment: "Ευθυγράμμιση",
    inspection: "Γενικός Έλεγχος",
    insurance: "Ασφάλιση",
    kteo: "ΚΤΕΟ",
    other: "Άλλο",
  };
  const costCategories = {
    fuel: "Καύσιμα",
    maintenance: "Συντήρηση",
    insurance: "Ασφάλεια",
    repair: "Επισκευές",
    taxes: "Τέλη",
    tolls: "Διόδια",
    parking: "Στάθμευση",
    wash: "Πλύσιμο",
    fines: "Πρόστιμα",
    oil: "Αλλαγή Λαδιών",
    service: "Γενικό Service",
    tires: "Αλλαγή Λάστιχων",
    brakes: "Φρένα",
    battery: "Μπαταρία",
    filters: "Φίλτρα",
    coolant: "Ψυκτικό Υγρό",
    transmission: "Κιβώτιο Ταχυτήτων",
    ac_service: "Service A/C",
    spark_plugs: "Μπουζί",
    timing_belt: "Ιμάντας Χρονισμού",
    alignment: "Ευθυγράμμιση",
    inspection: "Γενικός Έλεγχος",
    kteo: "ΚΤΕΟ",
    other: "Άλλο",
  };

  const labels = {
    status: (value) => statuses[value] || value,
    type: (value) => types[value] || value,
    costCategory: (value) => costCategories[String(value || "").trim().toLowerCase()] || value,
    maintenance: (record) => ({
      title: types[record?.maintenanceType] || record?.maintenanceType || "Συντήρηση",
      description: record?.notes || null,
    }),
    cost: (record) => ({
      title: costCategories[String(record?.category || "").trim().toLowerCase()] || record?.category || "Κόστος",
      description: record?.description || null,
    }),
  };

  window.CaReMindRecordLabels = labels;
  window.CaReMindMaintenanceLabels = labels;
})();
