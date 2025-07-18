// Simple Levenshtein distance for typo detection
function levenshtein(a, b) {
    if (a === b) return 0;
    const alen = a.length, blen = b.length;
    if (alen === 0) return blen;
    if (blen === 0) return alen;
    let v0 = new Array(blen + 1).fill(0);
    let v1 = new Array(blen + 1).fill(0);
    for (let i = 0; i <= blen; i++) v0[i] = i;
    for (let i = 0; i < alen; i++) {
        v1[0] = i + 1;
        for (let j = 0; j < blen; j++) {
            const cost = a[i] === b[j] ? 0 : 1;
            v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
        }
        [v0, v1] = [v1, v0];
    }
    return v0[blen];
}
import { db } from './database.js';
import { getToken } from './auth.js';
import config from '../config.global.js';

async function getAllSharePointListItems(listId) {
    const token = await getToken();
    if (!token) {
        console.error("Authentication token not available.");
        return [];
    }

    let items = [];
    let nextLink;

    const headers = new Headers({
        "Authorization": `Bearer ${token}`,
        "Accept": "application/json"
    });

    let url = `https://graph.microsoft.com/v1.0/sites/${config.sharePoint.siteId}/lists/${listId}/items?expand=fields`;

    do {
        const response = await fetch(url, { headers });
        const data = await response.json();
        if (!data.value) {
            console.error('No data.value returned from Graph API:', data);
            break;
        }
        items = items.concat(data.value);
        nextLink = data['@odata.nextLink'];
        url = nextLink;
    } while (nextLink);

    return items;
}

function groupClients(clients) {
    const grouped = new Map();
    clients.forEach(client => {
        const normalized = client.trim().toLowerCase();
        if (!grouped.has(normalized)) {
            grouped.set(normalized, new Set());
        }
        grouped.get(normalized).add(client);
    });
    return grouped;
}

async function startClientCleanup() {
    const cleanupArea = document.getElementById('client-cleanup-area');
    cleanupArea.innerHTML = '<p>Chargement des clients depuis SharePoint...</p>';

    const allVentes = await getAllSharePointListItems(config.sharePoint.lists.ventes);

    // Extract client name from 'Client' property only
    const validClients = [];
    const invalidItems = [];
    for (const item of allVentes) {
        const client = item.fields.Client;
        if (typeof client === 'string' && client.trim() !== '') {
            validClients.push(client);
        } else {
            invalidItems.push(item);
        }
    }

    const clients = [...new Set(validClients)];
    const groupedClients = groupClients(clients);

    cleanupArea.innerHTML = '';

    // 1. Flag possible typos/near-duplicates in client names
    const typoGroups = [];
    const clientArr = clients.map(c => c.trim().toLowerCase());
    for (let i = 0; i < clientArr.length; i++) {
        for (let j = i + 1; j < clientArr.length; j++) {
            const dist = levenshtein(clientArr[i], clientArr[j]);
            if (dist > 0 && dist <= 2) { // 1 or 2 letter difference
                typoGroups.push([clients[i], clients[j], dist]);
            }
        }
    }
    if (typoGroups.length > 0) {
        const typoDiv = document.createElement('div');
        typoDiv.style.border = '2px solid #ff9800';
        typoDiv.style.padding = '10px';
        typoDiv.style.marginBottom = '16px';
        typoDiv.style.background = '#fffbe6';
        const title = document.createElement('h4');
        title.textContent = `Clients suspects de faute de frappe ou de doublon (${typoGroups.length}) :`;
        typoDiv.appendChild(title);
        typoGroups.forEach(([a, b, dist]) => {
            const pairDiv = document.createElement('div');
            pairDiv.style.marginBottom = '10px';
            pairDiv.innerHTML = `<b>"${a}" ↔ "${b}" (distance: ${dist})</b>`;

            // For each variant, show affected ventes and a correction button
            [a, b].forEach(variant => {
                const affected = allVentes.filter(item => (item.fields.Client || '').trim() === variant.trim());
                if (affected.length > 0) {
                    const variantDiv = document.createElement('div');
                    variantDiv.style.marginLeft = '15px';
                    variantDiv.innerHTML = `<span style="color:#333">Entrées avec "${variant}":</span>`;
                    const ul = document.createElement('ul');
                    affected.forEach(item => {
                        const li = document.createElement('li');
                        li.textContent = `ID: ${item.id} | Client: ${item.fields.Client}`;
                        ul.appendChild(li);
                    });
                    variantDiv.appendChild(ul);
                    // Correction button
                    const fixBtn = document.createElement('button');
                    fixBtn.textContent = `Corriger tous les "${variant}"`;
                    fixBtn.style.marginBottom = '8px';
                    fixBtn.onclick = async () => {
                        await mergeClients(new Set([variant]), prompt(`Remplacer "${variant}" par :`, variant), allVentes);
                        variantDiv.innerHTML = `<span style='color:green'>Corrigé ! Rechargez la page pour voir les changements.</span>`;
                    };
                    variantDiv.appendChild(fixBtn);
                    pairDiv.appendChild(variantDiv);
                }
            });
            typoDiv.appendChild(pairDiv);
        });
        cleanupArea.appendChild(typoDiv);
    }

    // 2. Flag ventes with missing required fields (except 'commentaire')
    const requiredFields = ["Client", "produit", "quantit_x00e9_", "Date", "Montantpay_x00e9__x0028_CFA_x002"];
    const missingFieldsItems = allVentes.filter(item => {
        return requiredFields.some(f => !item.fields[f] || (typeof item.fields[f] === 'string' && item.fields[f].trim() === ''));
    });
    if (missingFieldsItems.length > 0) {
        const missingDiv = document.createElement('div');
        missingDiv.style.border = '2px solid #e53935';
        missingDiv.style.padding = '10px';
        missingDiv.style.marginBottom = '16px';
        missingDiv.style.background = '#fff0f0';
        const title = document.createElement('h4');
        title.textContent = `Entrées avec champs obligatoires manquants (${missingFieldsItems.length}) :`;
        missingDiv.appendChild(title);
        const list = document.createElement('ul');
        missingFieldsItems.forEach(item => {
            const li = document.createElement('li');
            const missing = requiredFields.filter(f => !item.fields[f] || (typeof item.fields[f] === 'string' && item.fields[f].trim() === ''));
            li.textContent = `ID: ${item.id} | Client: ${item.fields.Client || '(vide)'} | Champs manquants: ${missing.join(', ')} | Autres champs: ${JSON.stringify(item.fields)}`;
            list.appendChild(li);
        });
        missingDiv.appendChild(list);
        cleanupArea.appendChild(missingDiv);
    }

    // Show items with missing/invalid client for correction
    if (invalidItems.length > 0) {
        const invalidDiv = document.createElement('div');
        invalidDiv.style.border = '2px solid #e53935';
        invalidDiv.style.padding = '10px';
        invalidDiv.style.marginBottom = '16px';
        invalidDiv.style.background = '#fff0f0';
        const title = document.createElement('h4');
        title.textContent = `Clients manquants ou invalides (${invalidItems.length}) :`;
        invalidDiv.appendChild(title);
        const list = document.createElement('ul');
        invalidItems.forEach(item => {
            const li = document.createElement('li');
            const clientVal = item.fields.Client || '(vide)';
            li.textContent = `ID: ${item.id} | Client: ${clientVal} | Autres champs: ${JSON.stringify(item.fields)}`;
            list.appendChild(li);
        });
        invalidDiv.appendChild(list);
        cleanupArea.appendChild(invalidDiv);
    }

    for (const [normalized, variations] of groupedClients.entries()) {
        if (variations.size > 1) {
            const groupDiv = document.createElement('div');
            groupDiv.style.border = '1px solid #ccc';
            groupDiv.style.padding = '10px';
            groupDiv.style.marginBottom = '10px';

            const title = document.createElement('h5');
            title.textContent = `Fusionner les variations pour "${normalized}"`;
            groupDiv.appendChild(title);

            const list = document.createElement('ul');
            variations.forEach(v => {
                const listItem = document.createElement('li');
                listItem.textContent = v;
                list.appendChild(listItem);
            });
            groupDiv.appendChild(list);

            const targetInput = document.createElement('input');
            targetInput.type = 'text';
            targetInput.value = [...variations][0]; // Default to the first variation
            groupDiv.appendChild(targetInput);

            const mergeButton = document.createElement('button');
            mergeButton.textContent = 'Fusionner';
            mergeButton.onclick = async () => {
                const targetClient = targetInput.value;
                await mergeClients(variations, targetClient, allVentes);
                groupDiv.innerHTML = `<p>Fusionné vers "${targetClient}"</p>`;
            };
            groupDiv.appendChild(mergeButton);

            cleanupArea.appendChild(groupDiv);
        }
    }
}

async function mergeClients(variations, targetClient, allVentes) {
    const token = await getToken();
    if (!token) {
        console.error("Authentication token not available.");
        return;
    }

    const headers = new Headers({
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
    });

    for (const item of allVentes) {
        const client = item.fields.Client;
        if (variations.has(client)) {
            const url = `https://graph.microsoft.com/v1.0/sites/${config.sharePoint.siteId}/lists/${config.sharePoint.lists.ventes}/items/${item.id}`;
            // Only update 'Client' field
            const body = JSON.stringify({ fields: { Client: targetClient } });
            await fetch(url, { method: 'PATCH', headers, body });
        }
    }
}


// Always try to attach the event handler if the button exists
const startButton = document.getElementById('start-client-cleanup-btn');
if (startButton) {
    startButton.addEventListener('click', startClientCleanup);
}

// Also listen for auth-success in case the button appears later
window.addEventListener('auth-success', () => {
    const startButton = document.getElementById('start-client-cleanup-btn');
    if (startButton) {
        startButton.addEventListener('click', startClientCleanup);
    }
});
