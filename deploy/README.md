# Despliegue automático en el VM

Un timer de systemd revisa `main` cada 5 minutos. Si hay commits nuevos, el script `actualizar.sh` trae el código, compila la interfaz y reinicia `orquestador` solo cuando cambió `server/`.

## Reglas

- **No reinicia con ejecuciones en curso.** Un reinicio marca como fallidas las tareas activas (`worker.ts`). Si hay un `opencode run` vivo, espera al siguiente ciclo.
- **`web/` no reinicia nada.** El servidor lee `web/dist` en cada petición. Los clientes ven la versión nueva con el aviso de "Recargar ahora".
- **`bun install --frozen-lockfile` en cada ciclo** que cambie dependencias.
- **Si falla el build o el servidor no responde**, vuelve a la versión anterior y no reintenta ese mismo commit hasta que llegue uno nuevo.

## Instalación en el VM (una vez)

Usuario `orquestador`, repo en `/home/orquestador/orquestador`.

1. Pone el VM al día a mano, incluido el servidor, para que el timer parta de una versión conocida:

   ```bash
   cd ~/orquestador
   git switch main && git pull --ff-only
   (cd server && bun install --frozen-lockfile)
   (cd web && bun install --frozen-lockfile && bun run build)
   sudo systemctl restart orquestador
   ```

2. Revisa la ruta de `bun` y de `systemctl`:

   ```bash
   which bun        # si no es /home/orquestador/.bun/bin/bun, ajusta PATH en orquestador-deploy.service
   which systemctl  # si no es /usr/bin/systemctl, ajusta la regla de sudoers
   ```

3. Instala el script, las unidades y la regla de sudo, que solo permite reiniciar `orquestador`:

   ```bash
   chmod +x deploy/actualizar.sh
   sudo cp deploy/orquestador-deploy.service deploy/orquestador-deploy.timer /etc/systemd/system/
   echo 'orquestador ALL=(root) NOPASSWD: /usr/bin/systemctl restart orquestador' | sudo tee /etc/sudoers.d/orquestador-deploy >/dev/null
   sudo chmod 440 /etc/sudoers.d/orquestador-deploy
   sudo visudo -cf /etc/sudoers.d/orquestador-deploy
   sudo systemctl daemon-reload
   sudo systemctl enable --now orquestador-deploy.timer
   ```

## Uso y revisión

```bash
systemctl list-timers orquestador-deploy.timer     # cuándo corre el siguiente ciclo
journalctl -u orquestador-deploy -n 50             # qué hizo el último ciclo
sudo systemctl start orquestador-deploy.service    # forzar un ciclo ahora
```

Para pausar el despliegue automático: `sudo systemctl disable --now orquestador-deploy.timer`.

## Qué no cubre

- No corre migraciones a mano: las aplica el servidor al arrancar.
- Si `main` tiene cambios locales en el VM, el script se detiene con un aviso en el journal. No descarta nada.
- El patrón de ejecuciones (`opencode run`) cubre solo el runner actual. Hay que añadir Codex y agy cuando existan.
