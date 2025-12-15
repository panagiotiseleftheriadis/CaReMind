// database.js (clean version – no demo seeding)

class Database {
  /* ---------------- Core ---------------- */

  // Vehicles are often updated directly by other modules via localStorage.
  // To stay in sync, most getters re-read from storage each time.

  /* ---------------- Vehicles ---------------- */

  getVehicles(companyId) {
    const all = JSON.parse(localStorage.getItem('vehicles')) || [];
    if (companyId == null) return all;
    return all.filter(v => v.companyId == companyId);
  }

  getVehicleById(id) {
    const all = JSON.parse(localStorage.getItem('vehicles')) || [];
    return all.find(v => v.id == id) || null;
  }

  saveVehicles(allVehicles) {
    localStorage.setItem('vehicles', JSON.stringify(allVehicles || []));
  }

  addVehicle(vehicle) {
    const all = JSON.parse(localStorage.getItem('vehicles')) || [];

    // Uniqueness by chassis number (if provided)
    if (vehicle.chassisNumber) {
      const exists = all.some(v => (v.chassisNumber || '') === vehicle.chassisNumber);
      if (exists) {
        throw new Error('Υπάρχει ήδη όχημα με αυτόν τον αριθμό πλαισίου: ' + vehicle.chassisNumber);
      }
    }

    vehicle.id = Date.now();
    all.push(vehicle);
    this.saveVehicles(all);
    return vehicle.id;
  }

  updateVehicle(id, updates) {
    const all = JSON.parse(localStorage.getItem('vehicles')) || [];
    const idx = all.findIndex(v => v.id == id);
    if (idx === -1) return false;

    // If chassisNumber changes, enforce uniqueness again
    if (updates && updates.chassisNumber) {
      const duplicate = all.some(v => v.id != id && (v.chassisNumber || '') === updates.chassisNumber);
      if (duplicate) {
        throw new Error('Υπάρχει ήδη όχημα με αυτόν τον αριθμό πλαισίου: ' + updates.chassisNumber);
      }
    }

    all[idx] = { ...all[idx], ...updates };
    this.saveVehicles(all);
    return true;
  }

  deleteVehicle(id) {
    const all = JSON.parse(localStorage.getItem('vehicles')) || [];
    const idx = all.findIndex(v => v.id == id);
    if (idx === -1) return false;

    all.splice(idx, 1);
    this.saveVehicles(all);
    return true;
  }

  /* ---------------- Maintenance ---------------- */

  // Return all maintenance or filtered by vehicleId
  getMaintenanceSettings(vehicleId = null) {
    const maintenance = JSON.parse(localStorage.getItem('maintenance')) || [];
    if (vehicleId == null) return maintenance;
    return maintenance.filter(m => m.vehicleId == vehicleId);
  }

  // Upsert: by id if present, otherwise by (vehicleId + maintenanceType)
  saveMaintenanceSetting(setting) {
    let maintenance = JSON.parse(localStorage.getItem('maintenance')) || [];

    // normalize numeric fields (optional)
    if (setting.lastMileage != null) setting.lastMileage = parseInt(setting.lastMileage, 10);
    if (setting.nextMileage != null) setting.nextMileage = parseInt(setting.nextMileage, 10);
    if (!setting.status) setting.status = 'active';

    if (setting.id) {
      const idx = maintenance.findIndex(m => m.id == setting.id);
      if (idx !== -1) {
        maintenance[idx] = { ...maintenance[idx], ...setting, id: maintenance[idx].id };
      } else {
        maintenance.push({ ...setting, createdAt: new Date().toISOString() });
      }
    } else {
      const existingIndex = maintenance.findIndex(
        m => m.vehicleId == setting.vehicleId && m.maintenanceType === setting.maintenanceType
      );
      if (existingIndex !== -1) {
        maintenance[existingIndex] = { ...maintenance[existingIndex], ...setting };
      } else {
        setting.id = Date.now();
        setting.createdAt = new Date().toISOString();
        maintenance.push(setting);
      }
    }

    localStorage.setItem('maintenance', JSON.stringify(maintenance));
    return setting.id;
  }

  updateMaintenance(id, updates) {
    let maintenance = JSON.parse(localStorage.getItem('maintenance')) || [];
    const idx = maintenance.findIndex(m => m.id == id);
    if (idx === -1) return false;

    maintenance[idx] = { ...maintenance[idx], ...updates };
    localStorage.setItem('maintenance', JSON.stringify(maintenance));
    return true;
  }

  deleteMaintenance(id) {
    let maintenance = JSON.parse(localStorage.getItem('maintenance')) || [];
    const idx = maintenance.findIndex(m => m.id == id);
    if (idx === -1) return false;

    maintenance.splice(idx, 1);
    localStorage.setItem('maintenance', JSON.stringify(maintenance));
    return true;
  }

  // Upcoming within next 7 days (not completed) for vehicles of a specific company
  getUpcomingMaintenance(companyId) {
    const maintenance = JSON.parse(localStorage.getItem('maintenance')) || [];
    const vehicles = this.getVehicles(companyId);
    const vehicleIds = vehicles.map(v => v.id);

    const today = new Date();
    const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

    return maintenance.filter(item => {
      if (!vehicleIds.includes(item.vehicleId)) return false;
      if (item.status === 'completed') return false;
      if (!item.nextDate) return false;

      const dueDate = new Date(item.nextDate);
      return dueDate <= nextWeek && dueDate >= today;
    });
  }

  /* ---------------- Costs (helpers) ---------------- */

  // Return costs filtered by range & vehicle; suitable for CSV/export or further processing
  getCostsByPeriod(startDate, endDate, vehicleId = 'all') {
    let costs = JSON.parse(localStorage.getItem('costs')) || [];

    if (startDate) {
      const start = new Date(startDate);
      costs = costs.filter(c => new Date(c.date) >= start);
    }
    if (endDate) {
      const end = new Date(endDate);
      costs = costs.filter(c => new Date(c.date) <= end);
    }
    if (vehicleId !== 'all') {
      costs = costs.filter(c => c.vehicleId == vehicleId);
    }

    // sort by date desc
    costs.sort((a, b) => new Date(b.date) - new Date(a.date));
    return costs;
  }

  // Return monthly totals for a given year
  getMonthlyCosts(year = new Date().getFullYear(), vehicleId = 'all') {
    const costs = JSON.parse(localStorage.getItem('costs')) || [];
    const monthly = Array(12).fill(0);

    costs.forEach(cost => {
      const d = new Date(cost.date);
      if (d.getFullYear() !== year) return;
      if (vehicleId !== 'all' && cost.vehicleId != vehicleId) return;
      monthly[d.getMonth()] += Number(cost.amount) || 0;
    });

    return monthly;
  }
}

/* global singleton */
const db = new Database();
