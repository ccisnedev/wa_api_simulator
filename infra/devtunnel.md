# Devtunnel — Webhook callback para desarrollo

> Permite que wa_api en la nube envíe webhooks a help_api corriendo en tu PC.

```
wa_api (GCE) ──POST webhook──► https://{id}.devtunnels.ms ──devtunnel──► localhost:8080 (help_api)
```

La URL es persistente — no cambia entre encendido/apagado.

## Crear (una sola vez)

```powershell
devtunnel create wa-api-callback --allow-anonymous
devtunnel port create wa-api-callback -p 8080
```

## Encender

```powershell
devtunnel host wa-api-callback
```

Queda en foreground. Mientras esté activo, wa_api puede enviar webhooks
a help_api en `localhost:8080` vía `https://{id}.devtunnels.ms`.

## Apagar

`Ctrl+C` en la terminal donde corre.
Webhooks que wa_api intente enviar simplemente fallan — silencioso, sin consecuencias.

## Ver estado / URL

```powershell
devtunnel show wa-api-callback
```

## Eliminar

```powershell
devtunnel delete wa-api-callback
```

## Notas

- El tunnel expira a los 30 días de inactividad. Recrear con los mismos comandos.
- El puerto 8080 debe coincidir con el puerto donde help_api escucha localmente.
- Temporal — cuando help_api esté en la nube, se reemplaza por `https://help-api.cacsi.dev/...`
