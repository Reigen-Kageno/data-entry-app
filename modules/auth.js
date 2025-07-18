import config from '../config.global.js';

// Callback to be triggered on successful authentication
let onAuthSuccessCallback = null;

// MSAL configuration and instance
const msalConfig = {
    auth: {
        clientId: config.msalConfig.auth.clientId,
        authority: config.msalConfig.auth.authority,
        redirectUri: config.msalConfig.auth.redirectUri,
        navigateToLoginRequestUrl: true
    },
    cache: config.msalConfig.cache
};

const tokenRequest = {
    scopes: config.scopes.graph
};

const graphConfig = {
    machinesListId: config.sharePoint.lists.machines,
    siteId: config.sharePoint.siteId
};

// Initialize MSAL
const msalInstance = new msal.PublicClientApplication(msalConfig);

function handleAuthRedirect() {
    msalInstance.handleRedirectPromise()
        .then(response => {
            if (response && response.account) {
                console.log("User account found after redirect:", response.account.username);
                window.dispatchEvent(new CustomEvent('auth-success', { detail: { account: response.account } }));
                if (onAuthSuccessCallback) {
                    onAuthSuccessCallback();
                }
            }
        })
        .catch(error => {
            console.error("Error handling redirect:", error);
            if (error.errorMessage) {
                console.error("MSAL Error details:", error.errorMessage);
            }
        });
}

async function getToken() {
    console.log('getToken: Starting token acquisition...');
    const accounts = msalInstance.getAllAccounts();

    if (accounts.length > 0) {
        const silentRequest = {
            ...tokenRequest,
            account: accounts[0]
        };

        try {
            const response = await msalInstance.acquireTokenSilent(silentRequest);
            return response.accessToken;
        } catch (error) {
            console.log("Silent token acquisition failed, will try redirect:", error);
            if (error instanceof msal.InteractionRequiredAuthError) {
                // Fallback to interaction when silent call fails
                msalInstance.acquireTokenRedirect(silentRequest);
            } else {
                console.error("Unhandled error during silent token acquisition:", error);
            }
        }
    } else {
        // No accounts logged in, initiate login redirect.
        console.log('getToken: No accounts found, initiating login redirect...');
        msalInstance.loginRedirect(tokenRequest);
    }

    // In case of redirect, this function's promise will not resolve for the original caller,
    // as the page is navigating away. We return a promise that never resolves to prevent
    // any subsequent .then() chains from executing in the original context.
    return new Promise(() => {});
}

function setAuthSuccessCallback(callback) {
    onAuthSuccessCallback = callback;
}

// Export functions and configurations
export {
    msalInstance,
    getToken,
    graphConfig,
    setAuthSuccessCallback,
    handleAuthRedirect,
};
