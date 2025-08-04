// 1. Define the database
export const db = new Dexie("BasaltDataEntryDB");

// 2. Define the schema (tables and their indexes)
// Bump the version number when schema changes
db.version(17).stores({
  formEntries: '++id, &uniqueKey, date, syncStatus, machine, zoneActivite, resource, quantity, compteurMoteurDebut, compteurMoteurFin, sharepointId, notes',
  stockChecks: '[resourceName+date], resourceName, date, quantityOnHand, syncStatus, sharepointId',
  machines: '++id, sharepointId, displayName, idMachine, location, machineType, active',
  ventes: '++id, &uniqueKey, date, syncStatus, client, produit, quantite, montantPaye, commentaire, sharepointId',
  production: '++id, &uniqueKey, date, syncStatus, idCamion, poids, origine, destination, commentaire, sharepointId',
  clientPayments: '++id, &[client+date], amount, syncStatus, uniqueKey, sharepointId',
  deletionsQueue: '++id, sharepointId, listName'
}).upgrade(async (tx) => {
    console.log("Upgrading to database version 17. Adding clientPayments table.");
    // The new table will be created automatically by Dexie.
});
