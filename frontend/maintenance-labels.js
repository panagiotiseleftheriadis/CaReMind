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

  window.CaReMindMaintenanceLabels = {
    status: (value) => statuses[value] || value,
    type: (value) => types[value] || value,
  };
})();
