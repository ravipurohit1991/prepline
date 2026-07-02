import {
  Button,
  Dropdown,
  Input,
  Option,
  SpinButton,
  Textarea,
} from '@fluentui/react-components';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { Attention, RecipeIn } from '../api/types';

interface StepForm {
  name: string;
  instruction: string;
  duration: number;
  attention: Attention;
  equip: 'none' | 'burner' | 'oven';
  temp: number;
  dependsOn: number[];
  hold: number;
}

const blankStep = (index: number): StepForm => ({
  name: '',
  instruction: '',
  duration: 10,
  attention: 'active',
  equip: 'none',
  temp: 200,
  dependsOn: index > 0 ? [index - 1] : [],
  hold: 15,
});

export default function RecipeEditorPage() {
  const { recipeId } = useParams();
  const navigate = useNavigate();
  const editing = Boolean(recipeId);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [servings, setServings] = useState(4);
  const [tags, setTags] = useState('');
  const [ingredients, setIngredients] = useState('');
  const [steps, setSteps] = useState<StepForm[]>([blankStep(0)]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!recipeId) return;
    api
      .getRecipe(recipeId)
      .then((recipe) => {
        setName(recipe.name);
        setDescription(recipe.description);
        setServings(recipe.servings);
        setTags(recipe.tags.join(', '));
        setIngredients(recipe.ingredients.join('\n'));
        const indexOf = new Map(recipe.steps.map((s, i) => [s.id, i]));
        setSteps(
          recipe.steps.map((s) => {
            const oven = s.equipment.find((e) => e.kind === 'oven');
            const burner = s.equipment.find((e) => e.kind === 'burner');
            return {
              name: s.name,
              instruction: s.instruction,
              duration: s.duration_min,
              attention: s.attention,
              equip: oven ? 'oven' : burner ? 'burner' : 'none',
              temp: oven?.temp_c ?? 200,
              dependsOn: s.depends_on
                .map((id) => indexOf.get(id))
                .filter((i): i is number => i !== undefined),
              hold: s.hold_max_min,
            };
          }),
        );
      })
      .catch((e: Error) => setError(e.message));
  }, [recipeId]);

  const patchStep = (index: number, patch: Partial<StepForm>) => {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  const removeStep = (index: number) => {
    setSteps((prev) =>
      prev
        .filter((_, i) => i !== index)
        .map((s) => ({
          ...s,
          dependsOn: s.dependsOn.filter((d) => d !== index).map((d) => (d > index ? d - 1 : d)),
        })),
    );
  };

  const save = async () => {
    setSaving(true);
    setError('');
    const payload: RecipeIn = {
      name: name.trim(),
      description: description.trim(),
      servings,
      tags: tags
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
      ingredients: ingredients
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
      steps: steps.map((s) => ({
        name: s.name.trim(),
        instruction: s.instruction.trim(),
        duration_min: Math.max(1, Math.round(s.duration)),
        attention: s.attention,
        equipment:
          s.equip === 'none'
            ? []
            : s.equip === 'burner'
              ? [{ kind: 'burner' }]
              : [{ kind: 'oven', temp_c: Math.round(s.temp) }],
        depends_on: s.dependsOn,
        hold_max_min: Math.max(0, Math.round(s.hold)),
      })),
    };
    try {
      if (editing && recipeId) await api.updateRecipe(recipeId, payload);
      else await api.createRecipe(payload);
      navigate('/');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const valid = name.trim().length > 0 && steps.length > 0 && steps.every((s) => s.name.trim());

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">{editing ? 'Edit recipe' : 'New recipe'}</h1>
          <p className="page-sub">
            Steps carry a duration, whether they need your hands, and what they occupy — that is
            everything the scheduler needs.
          </p>
        </div>
        <div className="head-actions">
          <Button appearance="secondary" onClick={() => navigate('/')}>
            Cancel
          </Button>
          <Button appearance="primary" disabled={!valid || saving} onClick={save}>
            {saving ? 'Saving…' : 'Save recipe'}
          </Button>
        </div>
      </div>

      {error && <div className="warning-bar">⚠ {error}</div>}

      <div className="panel" style={{ marginBottom: 18 }}>
        <div className="form-grid">
          <div>
            <label className="field-label" htmlFor="recipe-name">
              Name
            </label>
            <Input
              id="recipe-name"
              value={name}
              onChange={(_, d) => setName(d.value)}
              placeholder="Herb-Butter Roast Chicken"
              style={{ width: '100%' }}
            />
          </div>
          <div style={{ display: 'flex', gap: 20 }}>
            <div>
              <label className="field-label" htmlFor="recipe-servings">
                Servings
              </label>
              <SpinButton
                id="recipe-servings"
                value={servings}
                min={1}
                max={50}
                onChange={(_, d) => setServings(d.value ?? servings)}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label className="field-label" htmlFor="recipe-tags">
                Tags (comma-separated)
              </label>
              <Input
                id="recipe-tags"
                value={tags}
                onChange={(_, d) => setTags(d.value)}
                placeholder="main, roast"
                style={{ width: '100%' }}
              />
            </div>
          </div>
          <div className="full">
            <label className="field-label" htmlFor="recipe-description">
              Description
            </label>
            <Textarea
              id="recipe-description"
              value={description}
              onChange={(_, d) => setDescription(d.value)}
              style={{ width: '100%' }}
            />
          </div>
          <div className="full">
            <label className="field-label" htmlFor="recipe-ingredients">
              Ingredients (one per line)
            </label>
            <Textarea
              id="recipe-ingredients"
              value={ingredients}
              onChange={(_, d) => setIngredients(d.value)}
              rows={4}
              style={{ width: '100%' }}
            />
          </div>
        </div>
      </div>

      <h2 style={{ fontSize: 15, margin: '0 0 10px' }}>Steps</h2>
      <div className="steps-editor">
        {steps.map((step, i) => (
          <div key={i} className="step-row">
            <span className="step-no">{i + 1}</span>
            <div>
              <label className="field-label">Step</label>
              <Input
                value={step.name}
                onChange={(_, d) => patchStep(i, { name: d.value })}
                placeholder="Parboil until fork-tender"
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label className="field-label">Minutes</label>
              <SpinButton
                value={step.duration}
                min={1}
                max={600}
                onChange={(_, d) => patchStep(i, { duration: d.value ?? step.duration })}
              />
            </div>
            <div>
              <label className="field-label">Attention</label>
              <Dropdown
                value={step.attention === 'active' ? 'Hands-on' : 'Unattended'}
                selectedOptions={[step.attention]}
                onOptionSelect={(_, d) =>
                  patchStep(i, { attention: (d.optionValue as Attention) ?? 'active' })
                }
              >
                <Option value="active">Hands-on</Option>
                <Option value="passive">Unattended</Option>
              </Dropdown>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <label className="field-label">Uses</label>
                <Dropdown
                  value={step.equip === 'none' ? 'Nothing' : step.equip === 'burner' ? 'Burner' : 'Oven'}
                  selectedOptions={[step.equip]}
                  onOptionSelect={(_, d) =>
                    patchStep(i, { equip: (d.optionValue as StepForm['equip']) ?? 'none' })
                  }
                >
                  <Option value="none">Nothing</Option>
                  <Option value="burner">Burner</Option>
                  <Option value="oven">Oven</Option>
                </Dropdown>
              </div>
              {step.equip === 'oven' && (
                <Input
                  aria-label="Oven temperature in Celsius"
                  type="number"
                  value={String(step.temp)}
                  onChange={(_, d) => patchStep(i, { temp: Number(d.value) || step.temp })}
                  contentAfter={<span style={{ fontSize: 11 }}>°C</span>}
                  style={{ width: 86 }}
                />
              )}
            </div>
            <div>
              <label className="field-label">Starts after</label>
              <Dropdown
                multiselect
                placeholder={i === 0 ? 'Start of cooking' : 'Nothing (parallel)'}
                value={step.dependsOn.map((d) => `${d + 1}. ${steps[d]?.name || 'step'}`).join(', ')}
                selectedOptions={step.dependsOn.map(String)}
                onOptionSelect={(_, d) =>
                  patchStep(i, { dependsOn: d.selectedOptions.map(Number).sort((a, b) => a - b) })
                }
                disabled={i === 0}
              >
                {steps.slice(0, i).map((s, j) => (
                  <Option key={j} value={String(j)}>
                    {`${j + 1}. ${s.name || 'step'}`}
                  </Option>
                ))}
              </Dropdown>
            </div>
            <div>
              <label className="field-label">Holds (min)</label>
              <SpinButton
                value={step.hold}
                min={0}
                max={240}
                onChange={(_, d) => patchStep(i, { hold: d.value ?? step.hold })}
              />
            </div>
            <Button
              appearance="subtle"
              aria-label={`Remove step ${i + 1}`}
              disabled={steps.length === 1}
              onClick={() => removeStep(i)}
            >
              ✕
            </Button>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12 }}>
        <Button appearance="secondary" onClick={() => setSteps((prev) => [...prev, blankStep(prev.length)])}>
          Add step
        </Button>
      </div>
    </div>
  );
}
