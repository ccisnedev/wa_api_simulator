# Análisis: VM compartida vs VM por simulador

## Contexto

El plan v3 crea **una VM por simulador**: `wa-sim-cacsi-1` para s1 y `wa-sim-cacsi-2`
para s2. El usuario pregunta si es mejor usar **una sola VM** que aloje N simuladores
como contenedores Docker independientes.

---

## Arquitectura actual (1 VM por simulador)

```
VM wa-sim-cacsi-1 (e2-small)          VM wa-sim-cacsi-2 (e2-small)
  Caddy :443 → wa-api:3001              Caddy :443 → wa-api:3001
  IP: 34.x.x.1                          IP: 34.x.x.2
  wa-api-s1.cacsi.dev                    wa-api-s2.cacsi.dev
```

Costo: ~$13.25 × 2 = **~$26.50/mes**

## Arquitectura propuesta (1 VM, N simuladores)

```
VM wa-sim-cacsi (e2-small)
  Caddy :443
    wa-api-s1.cacsi.dev → wa-api-s1:3001
    wa-api-s2.cacsi.dev → wa-api-s2:3002
  IP: 34.x.x.1
  DNS: ambos subdominios → misma IP
```

Costo: ~$13.25 × 1 = **~$13.25/mes**

Cada simulador corre como un contenedor Docker independiente con:
- Su propio `.env.production.sN`
- Su propio directorio `auth_info_baileys_sN/`
- Su propio puerto interno (3001, 3002, ..., 300N)
- Su propio `container_name: wa-api-s{N}`

Caddy sigue siendo uno solo, pero con múltiples bloques de dominio.

---

## Comparación detallada

### Costo

| Modelo | VMs | Costo/mes |
|--------|:---:|:---------:|
| 1 VM por sim (2 sims) | 2 | ~$26.50 |
| 1 VM por sim (5 sims) | 5 | ~$66.25 |
| VM compartida (2 sims) | 1 | ~$13.25 |
| VM compartida (5 sims) | 1 | ~$13.25 |

La diferencia crece linealmente. Con N simuladores el ahorro es $(N-1) × $13.25/mes.

### Recursos

e2-small = 2 vCPU (shared) + 2 GB RAM.

Consumo por simulador: ~80-120 MB RAM, CPU mínimo (WebSocket idle +
picos breves al procesar mensajes).

| Sims en 1 VM | RAM estimada | Cabe en e2-small (2 GB) |
|:------------:|:------------:|:-----------------------:|
| 2 | ~240-340 MB | ✅ Holgado |
| 3 | ~340-460 MB | ✅ Holgado |
| 5 | ~500-700 MB | ✅ Bien |
| 8+ | ~800+ MB | ⚠️ Evaluar e2-medium |

Para 2 simuladores: **sobra recurso**.

### Aislamiento

| Aspecto | 1 VM por sim | VM compartida |
|---------|:------------:|:-------------:|
| Falla de VM | Solo cae 1 sim | Caen todos |
| Falla de contenedor | N/A (1 por VM) | Solo cae ese contenedor (restart: always) |
| OOM / memory leak | Solo afecta esa VM | Podría afectar vecinos |
| Deploy | Independiente | Un rebuild de imagen es compartido |
| Restart Caddy | Solo afecta 1 sim | Corta TLS de todos (~1s) |

**Riesgo real**: bajo. Docker `restart: always` rearranca contenedores caídos.
Un OOM mataría al contenedor más grande, no a la VM. Caddy restart es <1 segundo.

### Complejidad de scripts

**1 VM por sim** — cada script hace todo (crear VM + setup + deploy):
```
01-create-vm.ps1 -SimId N     ← crea VM por sim
02-setup-vm.ps1 -SimId N      ← instala Docker por VM
03-deploy.ps1 -SimId N        ← deploy a su VM
```

**VM compartida** — separar creación de VM de despliegue de simuladores:
```
01-create-vm.ps1              ← crea la VM (una sola vez, sin SimId)
02-setup-vm.ps1               ← instala Docker (una sola vez, sin SimId)
03-deploy.ps1 -SimId N        ← deploy simulador N a la VM compartida
04-ssh-tunnel.ps1 -SimId N    ← tunnel al puerto correcto (300N)
05-backup.ps1 -SimId N        ← backup de un sim específico
```

Más limpio: la responsabilidad de "crear infra" está separada de "desplegar app".

### Docker Compose

**Opción A — Un docker-compose con todos los servicios (estático):**
Requiere editar manualmente cada vez que se agrega un sim. No escala.

**Opción B — docker-compose generado dinámicamente:**
`03-deploy.ps1` genera el docker-compose y el Caddyfile incluyendo todos
los simuladores que estén desplegados. Complejo — hay que descubrir qué
sims ya existen.

**Opción C — Un docker-compose por simulador + Caddy compartido (recomendada):**
```
/opt/wa-api/
├── caddy/
│   ├── Caddyfile           ← multi-dominio, regenerado al agregar sim
│   └── docker-compose.yml  ← solo Caddy
├── s1/
│   ├── docker-compose.yml  ← solo wa-api-s1
│   ├── .env.production     ← config de s1
│   ├── auth_info_baileys/
│   └── media/
├── s2/
│   ├── docker-compose.yml  ← solo wa-api-s2
│   ├── .env.production     ← config de s2
│   ├── auth_info_baileys/
│   └── media/
```

Ventajas de la opción C:
- Desplegar s1 no toca s2 (docker-compose separados)
- Agregar s3 no requiere regenerar docker-compose de s1 ni s2
- Solo regenera Caddyfile (y `docker exec caddy caddy reload`)
- Cada sim se gestiona independientemente: stop, start, logs, restart
- Estructura en disco clara y predecible

Caddy **no necesita** estar en un docker-compose compartido con los wa-api.
Puede ser un servicio de sistema o un docker-compose independiente. Los wa-api
se comunican con Caddy vía la red Docker compartida.

### Puertos

Cada simulador usa un puerto interno distinto. Convención: **300N**.

| SimId | Puerto interno | Container name |
|:-----:|:--------------:|----------------|
| 1 | 3001 | wa-api-s1 |
| 2 | 3002 | wa-api-s2 |
| N | 300N | wa-api-sN |

El `PORT` en `.env.production.sN` ya define esto. El Dockerfile ya usa `$PORT`.
No hace falta cambiar código — solo configuración.

Caddy rutea por subdominio al puerto correcto:
```
wa-api-s1.cacsi.dev → wa-api-s1:3001
wa-api-s2.cacsi.dev → wa-api-s2:3002
```

### SSH tunnel para dashboard

Cada simulador tiene su dashboard en su puerto. El tunnel mapea:
```powershell
# s1 dashboard → localhost:3001
gcloud compute ssh ... -- -L 3001:localhost:3001

# s2 dashboard → localhost:3002
gcloud compute ssh ... -- -L 3002:localhost:3002
```

También se pueden abrir ambos a la vez:
```powershell
gcloud compute ssh ... -- -L 3001:localhost:3001 -L 3002:localhost:3002
```

### DNS

Ambos subdominios apuntan a la **misma IP** — mismo A record value.

```
wa-api-s1.cacsi.dev → 34.x.x.1
wa-api-s2.cacsi.dev → 34.x.x.1
```

Caddy diferencia por hostname en el request (SNI/Host header).

---

## Impacto en scripts existentes

| Script | Cambio |
|--------|--------|
| `config.ps1` | VM name fijo (`wa-sim-cacsi`), una sola IP. SimId solo resuelve subdomain, envfile, port |
| `01-create-vm.ps1` | Sin `-SimId`. Crea 1 VM + 1 IP + firewall |
| `02-setup-vm.ps1` | Sin `-SimId`. Instala Docker, crea estructura base |
| `03-deploy.ps1` | Con `-SimId`. Copia código a `/opt/wa-api/sN/`, genera docker-compose para ese sim, regenera Caddyfile con todos los sims, reload Caddy |
| `04-ssh-tunnel.ps1` | Con `-SimId`. Tunnel al puerto 300N |
| `05-backup.ps1` | Con `-SimId`. Backup de `/opt/wa-api/sN/` |

Los cambios principales están en `config.ps1`, `01`, `02` (simplificar) y `03` (la más compleja — debe regenerar Caddyfile).

---

## Recomendación

**VM compartida con Opción C** (docker-compose por simulador + Caddy compartido).

Razones:
1. **Costo**: mitad para 2 sims, y no crece al agregar más
2. **Recursos**: e2-small maneja 5+ simuladores sin problema
3. **Aislamiento suficiente**: contenedores independientes, restart: always
4. **Deploy independiente**: un docker-compose por sim, no se tocan entre sí
5. **Scripts más limpios**: separa "crear infra" de "desplegar sim"
6. **Sin cambio de código**: solo cambia PORT en .env (ya parametrizado)

Riesgo aceptable: si la VM cae, caen todos — pero es una VM de staging/desarrollo,
no producción crítica. El auto-restart resuelve la mayoría de fallos.
