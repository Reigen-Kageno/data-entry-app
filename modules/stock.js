import { db } from './database.js';
import { getRessourcesByDate } from './data.js';
import { applySyncStatusClass } from './ui.js';

let dailyStockCheckOverrides = {};

export function clearDailyStockCheckOverrides() {
    dailyStockCheckOverrides = {};
}

export function getDailyStockCheckOverrides() {
    return dailyStockCheckOverrides;
}

// Function to get the most recent stock check for a resource before a specific date
async function getMostRecentStockCheck(resourceName, beforeDate) {
  try {
    return await db.stockChecks
      .where('resourceName').equals(resourceName)
      .and(s => s.date < beforeDate)
      .reverse()
      .first();
  } catch (error) {
    console.error(`Error fetching most recent stock check for ${resourceName} before ${beforeDate}:`, error);
    return null;
  }
}

// Function to save a new stock check
export async function saveStockCheck(stockCheckData) {
  try {
    // Add validation before saving
    if (!stockCheckData.resourceName || typeof stockCheckData.resourceName !== 'string' ||
        !stockCheckData.date || typeof stockCheckData.date !== 'string' ||
        typeof stockCheckData.quantityOnHand !== 'number' || isNaN(stockCheckData.quantityOnHand)) {
      console.error("Invalid stockCheckData:", stockCheckData);
      throw new Error("Attempted to save invalid stock check data.");
    }
    await db.stockChecks.put({
      ...stockCheckData,
      syncStatus: 0    // 0 = not synced, 1 = synced
    });
    console.log(`Stock check saved: ${JSON.stringify(stockCheckData)}`);
  } catch (error) {
    console.error('Error saving stock check:', error);
  }
}

export const updateCardStockDisplay = async function(resourceName, forDate) {
    const resourceStockCardsContainer = document.getElementById('resource-stock-cards-container');
    const cardElement = resourceStockCardsContainer.querySelector(`.stock-card[data-resource="${resourceName}"]`);
    if (!cardElement) return;

    let baseStockQty = 0;
    if (dailyStockCheckOverrides[forDate] && dailyStockCheckOverrides[forDate][resourceName] !== undefined) {
        baseStockQty = dailyStockCheckOverrides[forDate][resourceName];
    } else {
        // First check if there's a measured stock for today
        const todayStockCheck = await db.stockChecks.get([resourceName, forDate]);
        if (todayStockCheck) {
            baseStockQty = todayStockCheck.quantityOnHand;
            if (!dailyStockCheckOverrides[forDate]) dailyStockCheckOverrides[forDate] = {};
            dailyStockCheckOverrides[forDate][resourceName] = baseStockQty;
        } else {
            // If no measured stock today, calculate from previous day's final stock
            const previousDate = new Date(forDate);
            previousDate.setDate(previousDate.getDate() - 1);
            const prevDateStr = previousDate.toISOString().split('T')[0];
            
            // Get previous day's measured stock (if any)
            const prevDayStockCheck = await db.stockChecks.get([resourceName, prevDateStr]);
            
            // Get previous day's transactions to calculate ending stock
            const prevDayEntries = await getRessourcesByDate(prevDateStr);
            let prevDayNet = 0;
            
            prevDayEntries.forEach(entry => {
                if (entry.resource === resourceName) {
                    if (entry.machine.toLowerCase().startsWith('livraison')) {
                        prevDayNet += entry.quantity;
                    } else {
                        prevDayNet -= entry.quantity;
                    }
                }
            });

            if (prevDayStockCheck) {
                // If we had a measured stock yesterday, use it as base and apply yesterday's movements
                baseStockQty = prevDayStockCheck.quantityOnHand + prevDayNet;
            } else {
                // If no measured stock yesterday, look for most recent check and apply all movements since then
                const recentCheck = await getMostRecentStockCheck(resourceName, forDate);
                if (recentCheck) {
                    baseStockQty = recentCheck.quantityOnHand;
                    // Calculate all movements since that check
                    const movements = await calculateMovementsSinceDate(resourceName, recentCheck.date, forDate);
                    baseStockQty += movements;
                }
            }
        }
    }

    const formEntriesToday = await getRessourcesByDate(forDate);
    let sumDeliveriesToday = 0;
    let sumUsagesToday = 0;
    formEntriesToday.forEach(entry => {
        if (entry.resource === resourceName) {
            if (entry.machine.toLowerCase().startsWith('livraison')) {
                sumDeliveriesToday += entry.quantity;
            } else {
                sumUsagesToday += entry.quantity;
            }
        }
    });

    let netMovementToday = sumDeliveriesToday - sumUsagesToday;
    const displayStock = (dailyStockCheckOverrides[forDate] && dailyStockCheckOverrides[forDate][resourceName] !== undefined)
        ? dailyStockCheckOverrides[forDate][resourceName] + netMovementSinceLastCheck(resourceName, forDate, formEntriesToday, dailyStockCheckOverrides[forDate][resourceName])
        : baseStockQty + netMovementToday;

    const stockValueEl = cardElement.querySelector('.stock-value');
    if (stockValueEl) stockValueEl.textContent = `Stock : ${displayStock.toFixed(1)}`;

    const measuredDisplayEl = cardElement.querySelector('.measured-stock-display');
    if (measuredDisplayEl) {
        const todayMeasured = dailyStockCheckOverrides[forDate] && dailyStockCheckOverrides[forDate][resourceName] !== undefined
            ? dailyStockCheckOverrides[forDate][resourceName] : 'N/A';
        measuredDisplayEl.textContent = `Mesuré : ${todayMeasured}`;
    }

    const deltaEl = cardElement.querySelector('.stock-delta');
    if (deltaEl) deltaEl.textContent = `Δ Aujourd'hui : +${sumDeliveriesToday.toFixed(1)} | -${sumUsagesToday.toFixed(1)}`;

    const todayStockCheck = await db.stockChecks.get([resourceName, forDate]);
    if (todayStockCheck) {
        applySyncStatusClass(cardElement, todayStockCheck.syncStatus);
    } else {
        applySyncStatusClass(cardElement, -1); // No status to show
    }
}

async function handleSaveStockCheck(resourceName, cardElement, quantityOnHand) {
    const dateInput = document.getElementById('entry-date');
    const forDate = dateInput.value;
    if (isNaN(quantityOnHand)) return;

    const existingCheck = await db.stockChecks.get([resourceName, forDate]);

    const stockCheckData = {
        resourceName: resourceName,
        date: forDate,
        quantityOnHand: quantityOnHand,
        syncStatus: 0, // Mark as unsynced for the next sync operation
        sharepointId: existingCheck ? existingCheck.sharepointId : undefined
    };

    // Use put which handles both insert and update based on primary key
    await db.stockChecks.put(stockCheckData);
    if (!dailyStockCheckOverrides[forDate]) {
        dailyStockCheckOverrides[forDate] = {};
    }
    dailyStockCheckOverrides[forDate][resourceName] = quantityOnHand;

    await updateCardStockDisplay(resourceName, forDate);
    alert(`Vérification du stock pour ${resourceName} le ${forDate} enregistrée : ${quantityOnHand}.`);
}

export function promptForMeasuredStock(resourceName, cardElement) {
    const dateInput = document.getElementById('entry-date');
    const forDate = dateInput.value;
    let currentMeasured = (dailyStockCheckOverrides[forDate] && dailyStockCheckOverrides[forDate][resourceName] !== undefined)
        ? dailyStockCheckOverrides[forDate][resourceName]
        : '';
    const measuredStockStr = prompt(`Entrez le stock mesuré pour ${resourceName} le ${forDate} :`, currentMeasured);

    if (measuredStockStr === null) return;

    const quantityOnHand = parseFloat(measuredStockStr);
    if (isNaN(quantityOnHand)) {
        alert('Veuillez entrer un nombre valide pour le stock mesuré.');
        return;
    }        // Use the compound key for the update
    handleSaveStockCheck(resourceName, cardElement, quantityOnHand);
}

function netMovementSinceLastCheck(resourceName, forDate, formEntriesToday, lastCheckQty) {
    let net = 0;
    formEntriesToday.forEach(entry => {
        if (entry.resource === resourceName) {
            net += (entry.machine.toLowerCase().startsWith('livraison') ? entry.quantity : -entry.quantity);
        }
    });
    return net;
}

async function calculateMovementsSinceDate(resourceName, startDate, endDate) {
    let totalNet = 0;
    const entries = await db.formEntries
        .where('date')
        .between(startDate, endDate)
        .and(entry => entry.resource === resourceName)
        .toArray();

    entries.forEach(entry => {
        if (entry.machine.toLowerCase().startsWith('livraison')) {
            totalNet += entry.quantity;
        } else {
            totalNet -= entry.quantity;
        }
    });

    return totalNet;
}
