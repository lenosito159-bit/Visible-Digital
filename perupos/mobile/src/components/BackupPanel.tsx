import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LocalError, fechaPe, formatLimaDate, type BackupFile, type BackupSummary } from '@perupos/shared';
import { pickBackup, restoreFromBackup, makeAndShareBackup } from '@/lib/backup';
import { colors, font, shared, spacing } from '@/theme';
import { Banner, Button } from './ui';

const failMessage = (err: unknown) =>
  err instanceof LocalError ? err.message : 'No se pudo leer el archivo. Revisa que sea la copia de PeruPOS y vuelve a intentar.';

/**
 * Recuperar desde un archivo de copia: elegir el archivo, ver de qué negocio
 * y de qué fecha es, y confirmar. Reemplaza TODO lo del celular.
 */
export function RestorePanel({ replacing, onRestored }: { replacing: boolean; onRestored: () => void }) {
  const [picked, setPicked] = useState<{ backup: BackupFile; summary: BackupSummary } | null>(null);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async () => {
    setError(null);
    setSure(false);
    try {
      setPicked(await pickBackup());
    } catch (err) {
      setPicked(null);
      setError(failMessage(err));
    }
  };

  const restore = async () => {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      await restoreFromBackup(picked.backup);
      setPicked(null);
      onRestored();
    } catch (err) {
      setError(err instanceof LocalError ? err.message : 'No se pudo recuperar. Tu celular quedó como estaba.');
    } finally {
      setBusy(false);
    }
  };

  const s = picked?.summary;
  return (
    <View style={{ gap: spacing.sm }}>
      <Button label="Elegir el archivo de la copia" icon="folder-open" variant="secondary" onPress={() => void pick()} />
      {s && (
        <View style={[shared.card, { gap: 4 }]}>
          <Text style={styles.title}>{s.businessName}</Text>
          <Text style={styles.meta}>Copia del {formatLimaDate(s.createdAt)}</Text>
          <Text style={styles.meta}>
            {s.sales} ventas · {s.products} productos · {s.customers} clientes{s.photos ? ` · ${s.photos} fotos` : ''}
          </Text>
          {s.isDemo && <Text style={styles.meta}>Es una copia de la demostración (datos de ejemplo).</Text>}
          <Banner
            tone="warning"
            text={
              replacing
                ? 'Se BORRA todo lo que hay ahora en este celular y queda lo de la copia. Antes guardamos lo actual dentro de la app, por si acaso.'
                : 'Se recupera el negocio tal como estaba el día de la copia. Entrarás con el PIN de ese momento.'
            }
          />
          {replacing && !sure ? (
            <Button label="Recuperar esta copia" icon="refresh" variant="accent" onPress={() => setSure(true)} />
          ) : (
            <Button
              label={replacing ? 'Sí, reemplazar todo por la copia' : 'Recuperar esta copia'}
              icon="checkmark-circle"
              variant={replacing ? 'danger' : 'primary'}
              loading={busy}
              onPress={() => void restore()}
            />
          )}
        </View>
      )}
      {error && <Banner tone="danger" text={error} />}
    </View>
  );
}

/** "Mi negocio" → copia de seguridad: hacerla y guardarla, o recuperar una. */
export function BackupPanel({ lastBackupAt, onRestored }: { lastBackupAt: string | null; onRestored: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [showRestore, setShowRestore] = useState(false);

  const make = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const s = await makeAndShareBackup();
      setMessage({ tone: 'success', text: `Copia lista: ${s.sales} ventas, ${s.products} productos, ${s.customers} clientes. Revisa que se guardó donde elegiste.` });
    } catch (err) {
      setMessage({ tone: 'danger', text: err instanceof Error ? err.message : 'No se pudo hacer la copia.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={styles.meta}>
        {lastBackupAt ? `Última copia: ${fechaPe(lastBackupAt)}.` : 'Todavía no hiciste ninguna copia.'} Si se pierde o se malogra el celular,
        con la copia recuperas todo en otro.
      </Text>
      <Button label="Hacer copia y guardarla" icon="cloud-upload" big loading={busy} onPress={() => void make()} />
      <Text style={styles.meta}>
        Se abre el menú de compartir: guárdala FUERA de este celular (WhatsApp a ti mismo, Drive o correo). La copia tiene los datos de tu
        negocio y de tus clientes: guárdala donde solo tú la veas.
      </Text>
      {message && <Banner tone={message.tone} text={message.text} />}
      {showRestore ? (
        <RestorePanel replacing onRestored={onRestored} />
      ) : (
        <Button label="Recuperar desde una copia" icon="refresh" variant="ghost" onPress={() => setShowRestore(true)} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: font.large, fontWeight: '900', color: colors.text },
  meta: { fontSize: font.small, color: colors.textMuted },
});
