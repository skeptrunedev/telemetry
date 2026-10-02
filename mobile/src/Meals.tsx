import { useState } from "react";
import { View, Text, Pressable, Image, StyleSheet, Alert } from "react-native";
import { makeStyles, useTheme } from "./theme";
import { Meal, LoggedItem, deleteMeal, deleteMealItem, editMealItem, mealPhotoSource } from "./api";
import { Sheet, Field } from "./Sheet";
import { XIcon } from "./icons";

// The meals behind Today's totals, mirroring the web FoodLog card: each meal
// with its total, its items, and remove buttons for the whole meal or one
// item. Tapping an item opens a small editor (name / kcal / protein) on the
// same PATCH the agent's edit_food_item tool uses.
export function MealsCard({ meals, onChanged }: { meals: Meal[] | null; onChanged: () => void }) {
  const s = useS();
  const { c } = useTheme();
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<LoggedItem | null>(null);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
      onChanged();
    } catch (e) {
      Alert.alert("Couldn’t update the food log", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const removeMeal = (m: Meal, kcal: number) =>
    Alert.alert("Remove this meal?", `${m.note ? `${m.note}\n` : ""}${kcal} kcal · ${m.items.length} item${m.items.length === 1 ? "" : "s"}`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => run(`m${m.id}`, () => deleteMeal(m.id)) },
    ]);

  const removeItem = (it: LoggedItem) =>
    Alert.alert("Remove this item?", `${it.name} · ${it.kcal} kcal`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => run(`i${it.id}`, () => deleteMealItem(it.id)) },
    ]);

  return (
    <View style={s.card}>
      <Text style={s.cardLabel}>MEALS / TODAY</Text>
      {meals == null ? (
        <Text style={s.empty}>loading…</Text>
      ) : meals.length === 0 ? (
        <Text style={s.empty}>no meals logged yet — tell the agent what you ate</Text>
      ) : (
        meals.map((m, mi) => {
          const kcal = m.items.reduce((a, i) => a + i.kcal, 0);
          const protein = Math.round(m.items.reduce((a, i) => a + i.proteinG, 0));
          return (
            <View key={m.id} style={[s.meal, mi > 0 && s.mealBorder]}>
              <View style={s.mealHead}>
                {m.photoKeys[0] ? <Image style={s.thumb} source={mealPhotoSource(m.photoKeys[0])} /> : null}
                <View style={s.mealSum}>
                  <Text style={s.mealTotal}>
                    {kcal} kcal · {protein}g
                  </Text>
                  {m.note ? (
                    <Text style={s.mealNote} numberOfLines={2}>
                      {m.note}
                    </Text>
                  ) : null}
                </View>
                <Pressable
                  style={s.x}
                  disabled={busy != null}
                  onPress={() => removeMeal(m, kcal)}
                  accessibilityRole="button"
                  accessibilityLabel="Remove whole meal"
                  hitSlop={6}
                >
                  <XIcon size={15} color={c.muted} />
                </Pressable>
              </View>
              {m.items.map((it) => (
                <View key={it.id} style={s.item}>
                  <Pressable
                    style={s.itemMain}
                    disabled={busy != null}
                    onPress={() => setEditing(it)}
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${it.name}`}
                  >
                    <Text style={s.itemName}>{it.name}</Text>
                    <Text style={s.itemVal}>
                      {it.kcal}
                      <Text style={s.itemUnit}> · {Math.round(it.proteinG)}g</Text>
                    </Text>
                  </Pressable>
                  <Pressable
                    style={s.xSm}
                    disabled={busy != null}
                    onPress={() => removeItem(it)}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${it.name}`}
                    hitSlop={6}
                  >
                    <XIcon size={13} color={c.dim} />
                  </Pressable>
                </View>
              ))}
            </View>
          );
        })
      )}
      {meals && meals.length > 0 && <Text style={s.hint}>tap an item to fix it</Text>}
      <EditItemSheet
        key={editing?.id ?? "closed"}
        item={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          onChanged();
        }}
      />
    </View>
  );
}

function EditItemSheet({ item, onClose, onSaved }: { item: LoggedItem | null; onClose: () => void; onSaved: () => void }) {
  // Remounted per item (keyed by id), so the fields start from that item.
  const [name, setName] = useState(item?.name ?? "");
  const [kcal, setKcal] = useState(item ? String(item.kcal) : "");
  const [protein, setProtein] = useState(item ? String(Math.round(item.proteinG * 10) / 10) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!item) return;
    // Same bounds the worker enforces, checked here for a readable message.
    const n = name.trim();
    const k = Number(kcal);
    const p = Number(protein);
    if (!n) return setError("Name can’t be empty");
    if (!kcal.trim() || !Number.isFinite(k) || k < 0 || k > 5000) return setError("Calories must be 0–5000");
    if (!protein.trim() || !Number.isFinite(p) || p < 0 || p > 500) return setError("Protein must be 0–500 g");
    const patch: { name?: string; kcal?: number; proteinG?: number } = {};
    if (n !== item.name) patch.name = n.slice(0, 120);
    if (Math.round(k) !== item.kcal) patch.kcal = Math.round(k);
    if (p !== item.proteinG) patch.proteinG = p;
    if (!Object.keys(patch).length) return onClose();
    setSaving(true);
    setError(null);
    try {
      await editMealItem(item.id, patch);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={item != null} title="Edit food item" onClose={onClose} onSave={save} saving={saving} error={error}>
      <Field label="NAME" value={name} onChangeText={setName} maxLength={120} />
      <Field label="CALORIES (KCAL)" value={kcal} onChangeText={setKcal} keyboardType="number-pad" />
      <Field label="PROTEIN (G)" value={protein} onChangeText={setProtein} keyboardType="decimal-pad" />
    </Sheet>
  );
}

const useS = makeStyles((c) =>
  StyleSheet.create({
    card: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.line, padding: 16 },
    cardLabel: { color: c.muted, fontSize: 12, fontFamily: "monospace", letterSpacing: 1.5, marginBottom: 6 },
    empty: { color: c.dim, fontSize: 12, fontFamily: "monospace", paddingVertical: 8 },
    meal: { paddingVertical: 10 },
    mealBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
    mealHead: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 4 },
    thumb: { width: 40, height: 40, borderRadius: 8, backgroundColor: c.line },
    mealSum: { flex: 1, minWidth: 0 },
    mealTotal: { color: c.fg, fontSize: 15, fontWeight: "700" },
    mealNote: { color: c.muted, fontSize: 13, marginTop: 2 },
    x: { width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 8 },
    item: { flexDirection: "row", alignItems: "center" },
    itemMain: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "baseline", gap: 10, paddingVertical: 7, paddingLeft: 2 },
    itemName: { flex: 1, color: c.fg, fontSize: 14.5 },
    itemVal: { color: c.fg, fontSize: 14, fontFamily: "monospace" },
    itemUnit: { color: c.muted, fontSize: 13 },
    xSm: { width: 30, height: 30, alignItems: "center", justifyContent: "center", borderRadius: 7, marginLeft: 2 },
    hint: { color: c.dim, fontSize: 11, fontFamily: "monospace", letterSpacing: 0.6, marginTop: 4 },
  }),
);
