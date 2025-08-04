import { db } from './database.js';
import { saveClientPayment, getClientPayments, getAllEntriesByDate } from './data.js';

async function updateClientBalanceCard(client, forDate) {
    const container = document.getElementById('ehd-balance-container');
    if (!container) return;

    const allVentes = await db.ventes.where('client').equals(client).and(v => v.date <= forDate).toArray();
    const totalSold = allVentes.reduce((sum, entry) => sum + (entry.montantPaye || 0), 0);

    const payments = await getClientPayments(client);
    const paymentsToDate = payments.filter(p => p.date <= forDate);
    const totalPaid = paymentsToDate.reduce((sum, p) => sum + p.amount, 0);

    const balance = totalPaid - totalSold;

    const paymentToday = payments.find(p => p.date === forDate);
    const dailyPaidAmount = paymentToday ? paymentToday.amount : 0;

    container.innerHTML = `
        <div class="stock-card" id="ehd-balance-card" data-client="${client}">
            <span class="resource-name">${client} Balance</span>
            <div class="stock-value">${balance.toLocaleString('fr-FR')} CFA</div>
            <div class="measured-stock-display">Payé Aujourd'hui: ${dailyPaidAmount.toLocaleString('fr-FR')}</div>
        </div>
    `;

    document.getElementById('ehd-balance-card').addEventListener('click', () => {
        promptForClientPayment(client, forDate);
    });
}

async function promptForClientPayment(client, forDate) {
    const payments = await getClientPayments(client);
    const paymentToday = payments.find(p => p.date === forDate);
    const currentAmount = paymentToday ? paymentToday.amount : '';

    const amountStr = prompt(`Entrez le montant payé par ${client} le ${forDate}:`, currentAmount);

    if (amountStr === null) return;

    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount < 0) {
        alert('Veuillez entrer un montant valide.');
        return;
    }

    await saveClientPayment({
        client,
        date: forDate,
        amount,
    });

    // Refresh the card
    await updateClientBalanceCard(client, forDate);
}

export { updateClientBalanceCard };
