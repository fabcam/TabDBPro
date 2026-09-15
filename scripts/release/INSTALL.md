# TabDB Pro — Instalación (macOS)

Consultá, navegá y editá tus bases de datos (PostgreSQL / MySQL) directo desde
Chrome DevTools. Son dos piezas:

- **Bridge**: un pequeño servicio local que habla con la base de datos. Se instala
  como servicio de macOS (arranca solo en cada login, se reinicia si crashea) y
  escucha únicamente en `127.0.0.1:47321`.
- **Extensión de Chrome**: la interfaz, dentro de DevTools.

> Requisitos: macOS 12+ (Apple Silicon o Intel) y Google Chrome.

---

## 1. Instalar el bridge (el servicio)

Descomprimí el zip donde quieras y, desde una Terminal, entrá a la carpeta y corré:

```bash
./install.sh
```

Eso instala el binario en `~/Library/Application Support/TabDBPro/`, lo deja
corriendo y hace que arranque solo en cada inicio de sesión. Al terminar vas a ver
`✅ Bridge corriendo…`.

> **Nota de seguridad de macOS:** el binario viene sin firma de Apple. El instalador
> le quita el atributo de cuarentena automáticamente para que macOS lo deje correr.
> Si aun así aparece una advertencia de Gatekeeper, andá a
> *Ajustes del sistema → Privacidad y seguridad* y tocá *"Abrir de todos modos"*.

---

## 2. Cargar la extensión en Chrome

1. Abrí `chrome://extensions`
2. Activá **"Developer mode"** (interruptor arriba a la derecha)
3. Clic en **"Load unpacked"** y elegí la carpeta **`extension/`** de este paquete
4. Listo: la extensión "TabDB Pro" queda instalada

> Al cargarla "unpacked", la carpeta `extension/` tiene que **quedar donde está**.
> Si la movés o borrás, Chrome desactiva la extensión. Dejá el paquete descomprimido
> en una ubicación estable.

---

## 3. Usarla

1. Abrí Chrome DevTools (**Cmd + Opt + I**)
2. Buscá la pestaña **"TabDB Pro"** (puede estar en el menú `»` si no entra)
3. Clic en el engranaje **⚙** → **+ Add** → cargá los datos de tu conexión
   (host, puerto, base, usuario, contraseña)
4. Tus conexiones quedan guardadas en Chrome y se re-cargan solas cada vez que abrís
   el panel — incluso después de reiniciar la Mac

Por defecto las conexiones son **read-only**; podés habilitar escritura por conexión
al crearla.

---

## Actualizar

Cuando te pasen una versión nueva del zip: descomprimila y volvé a correr
`./install.sh`. Reemplaza el binario y recarga el servicio. Para la extensión,
apretá el botón de recargar (🔄) en `chrome://extensions`.

## Desinstalar

```bash
./uninstall.sh          # detiene y quita el servicio (conserva el binario)
./uninstall.sh --purge  # además borra el binario y los datos locales
```

Y quitá la extensión desde `chrome://extensions`.

---

## Si algo no anda

- **La extensión dice "Connecting to bridge…" y no conecta**
  El servicio quizá no está corriendo. Verificá:
  ```bash
  curl http://127.0.0.1:47321/health
  ```
  Debería devolver un JSON con `"ok":true`. Si no, mirá los logs:
  ```bash
  cat ~/Library/Logs/tabdb-bridge.err.log
  ```
- **Reinstalar el servicio desde cero:** `./uninstall.sh` y después `./install.sh`.
