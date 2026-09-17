# LinguaRead - Frontend

This is the frontend application for LinguaRead, a language learning tool that helps users improve their vocabulary by reading texts in foreign languages.

## Features

- User authentication (login/register)
- Add and manage texts in different languages
- Interactive reading experience with word highlighting
- Mark words as "learning" or "known"
- Add translations to words
- Track vocabulary progress

## Technologies Used

- React 18
- React Router for navigation
- Zustand for state management
- React Bootstrap for UI components
- Axios for API requests

## Getting Started

### Prerequisites

- Node.js 22.12+ or 24+ (Vite 8 and Vitest 5 minimum; CI uses 24, the Docker build 26)
- npm or yarn
- LinguaRead backend server running

### Installation

1. Clone the repository
2. Navigate to the client directory:
   ```
   cd client/lingua-read-client
   ```
3. Install dependencies:
   ```
   npm install
   ```
   or
   ```
   yarn install
   ```
4. Start the development server:
   ```
   npm start
   ```
   or
   ```
   yarn start
   ```

The application will be available at `http://localhost:3000`.

## Project Structure

```
src/
├── components/         # React components
│   ├── auth/           # Authentication components
│   ├── texts/          # Text-related components
│   └── ...
├── utils/              # Utility functions
│   ├── api.js          # API service functions
│   └── store.js        # Zustand stores
├── App.js              # Main application component
├── index.js            # Application entry point
└── index.css           # Global styles
```

## Usage

1. Register a new account or login with existing credentials
2. Add a new text in your target language
3. Click on words in the text to mark them as "learning" or "known"
4. Add translations to words for future reference
5. Track your vocabulary progress over time

## API Integration

The frontend communicates with the LinguaRead backend API. Make sure the backend server is running and the API URL in `src/utils/api.js` is correctly configured.

## License

This project is licensed under the MIT License. 