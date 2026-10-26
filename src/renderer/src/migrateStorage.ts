// Imported first by index.tsx: services read their saved data as their modules load.
import { migrateStorage } from './services/storageMigrations';

try {
  migrateStorage();
} catch (error) {
  // Saved data stays as it was; each panel falls back to defaults for what it cannot read.
  console.error('Saved data could not be upgraded:', error);
}
