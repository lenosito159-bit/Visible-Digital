import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BACKUP_PASSWORD_MIN, LocalError, fechaPe, formatLimaDate, type BackupFile, type BackupPeek, type BackupSummary } from '@perupos/shared';
import { makeAndShareBackup, openBackupText, pickBackupFile, restoreFromBackup, verifyBackupText } from '@/lib/backup';
import { colors, font, shared, spacing } from '@/theme';
import { Banner, Button, Chip, Field } from './ui';

const messageOf = (err: unknown, fallback: string) => (err instanceof LocalError ? err.message : fallback);

/** Qué pasa con la contraseña de la copia. Se muestra al crearla y al recuperarla. */
export const PASSWORD_EXPLAINED =
  'La copia queda protegida con esta contraseña: sin ella nadie puede abrirla. Anótala en un papel junto al código de recuperación. ' +
  'Si la olvidas, esa copia NO se puede abrir de ninguna forma (ni con el código de recuperación del PIN). ' +
  'Mientras tengas tu celular, puedes hacer otra copia con una contraseña nueva.';

function PasswordField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [show, setShow] = useState(false);
  return (
    <View>
      <Field label={label} value={value} onChangeText={onChange} secureTextEntry={!show} autoCapitalize="none" autoCorrect={false} />
      <View style={{ flexDirection: 'row', marginTop: -spacing.sm, marginBottom: spacing.sm }}>
        <Chip label={show ? 'Ocultar' : 'Mostrar'} icon={show ? 'eye-off' : 'eye'} selected={show} onPress={() => setShow(!show)} />
      </View>
    </View>
  );
}

/** Elegir un archivo de copia y abrirlo con su contraseña (para comprobarlo o recuperarlo). */
function OpenBackup({
  actionLabel,
  onOpened,
}: {
  actionLabel: string;
  onOpened: (text: string, password: string) => Promise<void>;
}) {
  const [picked, setPicked] = useState<{ text: string; peek: BackupPeek; name: string } | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async () => {
    setError(null);
    setPassword('');
    try {
      setPicked(await pickBackupFile());
    } catch (err) {
      setPicked(null);
      setError(messageOf(err, 'No se pudo leer el archivo. Revisa que sea la copia de PeruPOS.'));
    }
  };
  const open = async () => {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      await onOpened(picked.text, password);
    } catch (err) {
      setError(messageOf(err, 'No se pudo abrir la copia.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: spacing.sm }}>
      <Button label={picked ? 'Elegir otro archivo' : 'Elegir el archivo de la copia'} icon="folder-open" variant="secondary" onPress={() => void pick()} />
      {picked && (
        <View style={[shared.card, { gap: 4 }]}>
          <Text style={styles.title}>{picked.peek.businessName}</Text>
          <Text style={styles.meta}>
            Copia del {formatLimaDate(picked.peek.createdAt)}
            {picked.peek.isDemo ? ' · demostración' : ''}
          </Text>
          {picked.peek.encrypted ? (
            <PasswordField label="Contraseña de la copia" value={password} onChange={setPassword} />
          ) : (
            <Text style={styles.meta}>Esta copia es antigua y no tiene contraseña.</Text>
          )}
          <Button
            label={busy ? 'Abriendo… puede tardar unos segundos' : actionLabel}
            icon="lock-open"
            loading={busy}
            disabled={picked.peek.encrypted && password.length === 0}
            onPress={() => void open()}
          />
        </View>
      )}
      {error && <Banner tone="danger" text={error} />}
    </View>
  );
}

/**
 * Recuperar desde un archivo de copia: elegir el archivo, poner la contraseña,
 * ver de qué negocio y fecha es, y confirmar. Reemplaza TODO lo del celular.
 */
export function RestorePanel({ replacing, onRestored }: { replacing: boolean; onRestored: () => void }) {
  const [opened, setOpened] = useState<{ backup: BackupFile; summary: BackupSummary; password: string } | null>(null);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const restore = async () => {
    if (!opened) return;
    setBusy(true);
    setError(null);
    try {
      await restoreFromBackup(opened.backup, opened.password);
      setOpened(null);
      onRestored();
    } catch (err) {
      setError(messageOf(err, 'No se pudo recuperar. Tu celular quedó como estaba.'));
    } finally {
      setBusy(false);
    }
  };

  if (!opened) {
    return (
      <View style={{ gap: spacing.sm }}>
        <Text style={styles.meta}>
          Necesitas el archivo de la copia (descárgalo de WhatsApp, Drive o tu correo) y su contraseña. Si olvidaste la contraseña, esa
          copia no se puede abrir.
        </Text>
        <OpenBackup
          actionLabel="Abrir copia"
          onOpened={async (text, password) => {
            const { backup, summary } = await openBackupText(text, password);
            setSure(false);
            setOpened({ backup, summary, password });
          }}
        />
      </View>
    );
  }

  const s = opened.summary;
  return (
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
      <Button label="Cancelar" variant="ghost" onPress={() => setOpened(null)} />
      {error && <Banner tone="danger" text={error} />}
    </View>
  );
}

/** "Mi negocio" → copia de seguridad: 1) hacerla, 2) comprobar que quedó guardada, 3) recuperar. */
export function BackupPanel({
  lastBackupAt,
  backupVerifiedAt,
  onRestored,
}: {
  lastBackupAt: string | null;
  backupVerifiedAt: string | null;
  onRestored: () => void;
}) {
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger' | 'warning'; text: string } | null>(null);
  const [verified, setVerified] = useState<string | null>(null);
  const [showVerify, setShowVerify] = useState(false);
  const [showRestore, setShowRestore] = useState(false);

  const make = async () => {
    setMessage(null);
    if (password !== password2) return setMessage({ tone: 'danger', text: 'Las dos contraseñas no son iguales.' });
    setBusy(true);
    try {
      const { summary, fileName } = await makeAndShareBackup(password);
      setPassword('');
      setPassword2('');
      setShowVerify(true);
      setMessage({
        tone: 'warning',
        text:
          `Se armó la copia "${fileName}" (${summary.sales} ventas, ${summary.products} productos, ${summary.customers} clientes) y se abrió el menú para guardarla. ` +
          'Todavía NO sabemos si se guardó. Compruébala en el paso 2.',
      });
    } catch (err) {
      setMessage({ tone: 'danger', text: messageOf(err, err instanceof Error ? err.message : 'No se pudo hacer la copia.') });
    } finally {
      setBusy(false);
    }
  };

  const status = backupVerifiedAt
    ? `Última copia comprobada: ${fechaPe(backupVerifiedAt)}.`
    : lastBackupAt
      ? `Hiciste una copia el ${fechaPe(lastBackupAt)}, pero todavía no la comprobaste.`
      : 'Todavía no tienes ninguna copia.';

  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={styles.meta}>{status} Si se pierde o se malogra el celular, con la copia recuperas todo en otro.</Text>

      <Text style={styles.step}>1. Hacer la copia</Text>
      <Banner tone="info" icon="key" text={PASSWORD_EXPLAINED} />
      <PasswordField label={`Contraseña de la copia (mínimo ${BACKUP_PASSWORD_MIN})`} value={password} onChange={setPassword} />
      <PasswordField label="Repite la contraseña" value={password2} onChange={setPassword2} />
      <Button
        label={busy ? 'Protegiendo la copia… puede tardar unos segundos' : 'Hacer copia y compartirla'}
        icon="cloud-upload"
        big
        loading={busy}
        disabled={password.length < BACKUP_PASSWORD_MIN || password2.length === 0}
        onPress={() => void make()}
      />
      <Text style={styles.meta}>
        En el menú, guárdala FUERA de este celular: WhatsApp a ti mismo, Drive o correo. Guárdala donde solo tú la veas.
      </Text>
      {message && <Banner tone={message.tone} text={message.text} />}

      <Text style={styles.step}>2. Comprobar que quedó guardada</Text>
      <Text style={styles.meta}>
        Abre la copia desde donde la guardaste (descárgala de WhatsApp o Drive) y pon su contraseña. Así sabes que la puedes recuperar.
      </Text>
      {verified && <Banner tone="success" icon="shield-checkmark" text={verified} />}
      {showVerify ? (
        <OpenBackup
          actionLabel="Comprobar copia"
          onOpened={async (text, pw) => {
            const s = await verifyBackupText(text, pw);
            setShowVerify(false);
            setVerified(
              `Copia comprobada: se abre bien con su contraseña. Es del ${formatLimaDate(s.createdAt)} y tiene ${s.sales} ventas, ${s.products} productos y ${s.customers} clientes.`,
            );
          }}
        />
      ) : (
        <Button label="Comprobar una copia guardada" icon="shield-checkmark" variant="secondary" onPress={() => setShowVerify(true)} />
      )}

      <Text style={styles.step}>3. Recuperar</Text>
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
  step: { fontSize: font.body, fontWeight: '900', color: colors.secondary, marginTop: spacing.md },
});
