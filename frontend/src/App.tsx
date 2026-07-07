import { FluentProvider } from '@fluentui/react-components';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import CookPage from './pages/CookPage';
import LibraryPage from './pages/LibraryPage';
import PlanNewPage from './pages/PlanNewPage';
import PlansPage from './pages/PlansPage';
import RecipeEditorPage from './pages/RecipeEditorPage';
import ScorePage from './pages/ScorePage';
import ShoppingListPage from './pages/ShoppingListPage';
import { lightTheme } from './theme';

export default function App() {
  return (
    <Routes>
      <Route
        path="/cook/:sessionId"
        element={
          // Cook mode runs in its own dark "service" theme, no shell chrome.
          <CookPage />
        }
      />
      <Route
        element={
          <FluentProvider theme={lightTheme} style={{ background: 'transparent' }}>
            <AppShell />
          </FluentProvider>
        }
      >
        <Route path="/" element={<LibraryPage />} />
        <Route path="/recipes/new" element={<RecipeEditorPage />} />
        <Route path="/recipes/:recipeId" element={<RecipeEditorPage />} />
        <Route path="/meals" element={<PlansPage />} />
        <Route path="/meals/new" element={<PlanNewPage />} />
        <Route path="/meals/:planId" element={<ScorePage />} />
        <Route path="/meals/:planId/shopping" element={<ShoppingListPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
