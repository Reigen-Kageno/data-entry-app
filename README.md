# Basalt Site Data Entry App

This application is designed for SOECO's daily data tracking needs, including resource consumption, production, and sales. It allows operators to record machine usage, resource consumption, production output, and sales data, which syncs with SharePoint for centralized data management.

## Technical Overview

### Database Schema (Version 15)
The application now uses a three-tab navigation system (`Ressources`, `Production`, `Ventes`).

For detailed schema definitions, please refer to `PROJECT_CHARTER.md`.

For a comprehensive technical architecture overview, see `ARCHITECTURE.md`.

### Core Features

#### Tab-Based Navigation
- **Ressources**: Tracks daily resource consumption by machine.
- **Production**: Logs the movement of basalt from extraction/stockage to crushing/stockage.
- **Ventes**: Records daily sales of products to various clients.

#### Machine Data Management
- SharePoint integration for machine list.
- Machine selection with autocomplete and validation.
- Prevents duplicate machine entries per day.
- Shows machine display name for clarity.
- Tracks machine active status from SharePoint.

#### Production Tracking
- Records production entries with truck ID, weight, origin, and destination.
- Uses the master machine list for truck ID autocomplete.

#### Sales Tracking
- Records sales entries with client, product, quantity, and payment amount.
- Features a dynamic autocomplete for client names based on previous entries.

#### Data Refresh from Server
- **Full Data Overwrite**: A new "Actualiser les données du serveur" button allows users to completely refresh the local data with the data from the SharePoint server.
- **Use Cases**: This feature is intended for initial setup on a new device or for recovery in case of local data corruption.
- **Data Integrity**: The process is atomic, ensuring that the local database is not left in a partially updated state.

#### Resource Tracking
```javascript
const RESOURCES = [
    'Gasoil', 
    'HuileMoteur', 
    'HuileHydraulique', 
    'HuileLubrification', 
    'HuileBoite', 
    'HuilePont', 
    'HuileDirection'
];
```

#### Zone Activity Tracking
```javascript
const ZONES = [
    'Concassage', 
    'Extraction', 
    'Autres', 
    'BTC'
];

## Development Notes

For a list of known issues, planned features, and future improvements, please refer to the `Todo.MD` file, which serves as the single source of truth for development tasks.

### Deployment Security
**Important:** The `config.global.js` file contains sensitive information (like client IDs) and is intended for development purposes only. In a production environment, this file must be replaced or its contents secured using environment variables or a secrets management service. Do not commit the production configuration to the repository.

## Changelog
For a detailed history of changes and updates, please refer to the `CHANGELOG.md` file.

## Getting Started

1.  **Installation:**  [Provide installation instructions, e.g., "Clone the repository and run `pip install -r requirements.txt`"].
2.  **Configuration:**  [Explain any necessary configuration steps, e.g., "Configure the database connection in `config.py`"].
3.  **Running the Application:**  [Provide instructions for running the app, e.g., "Run `python main.py`"].

## Usage

[Provide a brief overview of how to use the application, including screenshots or examples if helpful.]

## Contributing

[If the project is open-source, provide guidelines for contributing.]

## License

[Specify the license under which the application is released.]

## Contact

[Provide contact information for support or inquiries.]
