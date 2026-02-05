# Social Publisher — Flujos de OAuth por Plataforma

## Fuente de verdad
Esta documentación está basada en la documentación oficial de Late.dev verificada el 2026-02-05:
- https://docs.getlate.dev/core/connect
- https://docs.getlate.dev/quickstart

---

## Resumen de métodos de conexión por plataforma

| Plataforma | Método | Requiere selección adicional | Modo headless |
|------------|--------|------------------------------|---------------|
| Facebook | OAuth | ✅ Seleccionar Page | ✅ Soportado |
| Instagram | OAuth (vía Facebook) | ✅ Seleccionar Page (misma que Facebook) | ✅ Soportado |
| LinkedIn | OAuth | ✅ Seleccionar Organization (o personal) | ✅ Soportado |
| Twitter/X | OAuth | ❌ | ❌ No necesario |
| TikTok | OAuth | ❌ | ❌ No necesario |
| YouTube | OAuth | ❌ | ❌ No necesario |
| Threads | OAuth (vía Instagram) | ❌ | ❌ No necesario |
| Reddit | OAuth | ❌ | ❌ No necesario |
| Pinterest | OAuth | ✅ Seleccionar Board | ✅ Soportado |
| Bluesky | App Password | ❌ | N/A (no es OAuth) |
| Google Business | OAuth | ✅ Seleccionar Location | ✅ Soportado |
| Telegram | Bot Token | ❌ | N/A (no es OAuth) |
| Snapchat | OAuth | ✅ Seleccionar Public Profile | ✅ Soportado |

---

## Flujo estándar (plataformas sin selección adicional)

**Aplica a:** Twitter/X, TikTok, YouTube, Threads, Reddit

### Pasos:
1. Pioneer llama `GET /v1/connect/{platform}?profileId={id}&redirect_url={callback_url}`
2. Late.dev devuelve `{ authUrl: "https://..." }`
3. Pioneer muestra el enlace al cliente
4. El cliente abre el enlace → autoriza en la plataforma → es redirigido al callback
5. La cuenta queda conectada automáticamente
6. Pioneer puede verificar con `GET /v1/accounts`

### Callback URL de Pioneer
```
{APP_URL}/api/social/callback
```

El callback recibe query params:
- `connected={platform}` — la plataforma conectada
- `profileId={id}` — ID del perfil
- `username={name}` — nombre de usuario conectado

---

## Flujo headless para Facebook

Facebook requiere que el usuario seleccione una Page después del OAuth.

### Pasos:
1. Pioneer llama:
   ```
   GET /v1/connect/facebook?profileId={id}&redirect_url={callback_url}&headless=true
   ```
2. Late.dev devuelve `{ authUrl: "..." }`
3. El cliente abre el enlace → autoriza en Facebook → es redirigido al callback de Pioneer
4. El callback recibe estos query params:
   - `profileId` — ID del perfil de Late.dev
   - `tempToken` — token temporal de Facebook
   - `userProfile` — JSON URL-encoded con datos del usuario
   - `connect_token` — token corto para autenticación con Late.dev
   - `platform=facebook`
   - `step=select_page`
5. Pioneer llama a Late.dev para obtener las páginas disponibles:
   ```
   GET /v1/connect/facebook/select-page?profileId={id}&tempToken={token}
   Header: X-Connect-Token: {connect_token}
   ```
   Respuesta:
   ```json
   {
     "pages": [
       {
         "id": "123456789",
         "name": "Mi Panadería",
         "username": "mipanaderia",
         "access_token": "EAAxxxxx...",
         "category": "Bakery",
         "tasks": ["MANAGE", "CREATE_CONTENT"]
       }
     ]
   }
   ```
6. Pioneer muestra las páginas al cliente y le pide seleccionar
7. Pioneer llama para guardar la selección:
   ```
   POST /v1/connect/facebook/select-page
   Header: X-Connect-Token: {connect_token}
   Body: {
     "profileId": "...",
     "pageId": "123456789",
     "tempToken": "EAAxxxxx...",
     "userProfile": { "id": "...", "name": "..." }
   }
   ```
8. Cuenta conectada exitosamente

### Notas importantes para Facebook:
- Solo se pueden conectar Business Pages, NO perfiles personales
- El usuario debe ser admin de la página
- Instagram se conecta vía el OAuth de Facebook (misma autorización)

---

## Flujo headless para LinkedIn

LinkedIn requiere selección entre cuenta personal y organización.

### Pasos:
1. Pioneer llama:
   ```
   GET /v1/connect/linkedin?profileId={id}&redirect_url={callback_url}&headless=true
   ```
2. El cliente autoriza → es redirigido al callback
3. El callback recibe:
   - `profileId`
   - `pendingDataToken` — token para obtener datos OAuth (NO se pasan por URL para evitar URLs largos)
   - `connect_token`
   - `platform=linkedin`
   - `step=select_organization` (solo si el usuario tiene acceso a organizaciones)
4. Pioneer obtiene los datos OAuth:
   ```
   GET /v1/connect/pending-data?token={pendingDataToken}
   ```
   Respuesta:
   ```json
   {
     "platform": "linkedin",
     "profileId": "abc123",
     "tempToken": "AQV...",
     "refreshToken": "AQW...",
     "expiresIn": 5183999,
     "userProfile": {
       "id": "ABC123",
       "username": "John Doe",
       "displayName": "John Doe",
       "profilePicture": "https://..."
     },
     "selectionType": "organizations",
     "organizations": [
       { "id": "12345", "urn": "urn:li:organization:12345", "name": "Mi Empresa" }
     ]
   }
   ```
   **⚠️ IMPORTANTE:** Este endpoint es de un solo uso — los datos se borran después de consultarlos. Expiran en 10 minutos.
5. Pioneer muestra las opciones al cliente: cuenta personal o organización
6. Pioneer guarda la selección:
   ```
   POST /v1/connect/linkedin/select-organization
   Header: X-Connect-Token: {connect_token}
   Body: {
     "profileId": "...",
     "tempToken": "AQV...",
     "userProfile": { ... },
     "accountType": "personal" | "organization",
     "selectedOrganization": { "id": "12345", "urn": "urn:li:organization:12345", "name": "Mi Empresa" }
   }
   ```

### Nota:
- Si el usuario no tiene acceso a organizaciones, `step=select_organization` NO aparece en el callback y la cuenta se conecta directamente como personal.

---

## Flujo headless para Pinterest

Pinterest requiere selección de Board.

### Pasos:
1. Pioneer llama:
   ```
   GET /v1/connect/pinterest?profileId={id}&redirect_url={callback_url}&headless=true
   ```
2. El cliente autoriza → redirigido al callback con:
   - `tempToken`, `userProfile`, `connect_token`, `platform=pinterest`, `step=select_board`
3. Pioneer obtiene los boards:
   ```
   GET /v1/connect/pinterest/select-board?profileId={id}&tempToken={token}
   Header: X-Connect-Token: {connect_token}
   ```
4. Pioneer muestra los boards y el cliente selecciona uno
5. Pioneer guarda:
   ```
   POST /v1/connect/pinterest/select-board
   Header: X-Connect-Token: {connect_token}
   Body: { "profileId": "...", "boardId": "...", "boardName": "...", "tempToken": "...", "userProfile": {...} }
   ```

---

## Flujo headless para Google Business

Google Business requiere selección de Location.

### Pasos:
1. Pioneer llama:
   ```
   GET /v1/connect/googlebusiness?profileId={id}&redirect_url={callback_url}&headless=true
   ```
2. El cliente autoriza → redirigido al callback con:
   - `tempToken`, `userProfile`, `connect_token`, `platform=googlebusiness`, `step=select_location`
3. Pioneer obtiene las ubicaciones:
   ```
   GET /v1/connect/googlebusiness/locations?profileId={id}&tempToken={token}
   Header: X-Connect-Token: {connect_token}
   ```
4. Pioneer muestra las ubicaciones y el cliente selecciona una
5. Pioneer guarda:
   ```
   POST /v1/connect/googlebusiness/select-location
   Header: X-Connect-Token: {connect_token}
   Body: {
     "profileId": "...",
     "locationId": "...",
     "tempToken": "...",
     "userProfile": { ... }  // IMPORTANTE: contiene refresh token
   }
   ```

---

## Bluesky — Conexión por App Password (NO OAuth)

### Pasos:
1. Pioneer le pide al cliente:
   - Su handle de Bluesky (ej: `usuario.bsky.social`)
   - Un App Password (se genera en Bluesky → Settings → App Passwords)
2. Pioneer llama:
   ```
   POST /v1/connect/bluesky
   Body: {
     "profileId": "...",
     "handle": "usuario.bsky.social",
     "appPassword": "xxxx-xxxx-xxxx-xxxx"
   }
   ```
3. Cuenta conectada. No se necesita OAuth ni callback.

### Notas:
- El App Password tiene formato `xxxx-xxxx-xxxx-xxxx`
- NO es la contraseña principal de la cuenta
- Bluesky tiene límite de 300 caracteres por post

---

## Telegram — Conexión por Bot Token (NO OAuth)

### Pasos:
1. El cliente debe crear un bot en Telegram vía @BotFather
2. @BotFather le da un token
3. Pioneer usa ese token para conectar

---

## Flujo headless para Snapchat

### Pasos:
1. Pioneer llama:
   ```
   GET /v1/connect/snapchat?profileId={id}&redirect_url={callback_url}&headless=true
   ```
2. El cliente autoriza → redirigido al callback con:
   - `tempToken`, `userProfile`, `publicProfiles` (JSON con perfiles públicos), `connect_token`, `platform=snapchat`, `step=select_public_profile`
3. Pioneer muestra los perfiles públicos y el cliente selecciona uno
4. Pioneer guarda:
   ```
   POST /v1/connect/snapchat/select-profile
   Header: X-Connect-Token: {connect_token}
   Body: { "profileId": "...", "publicProfileId": "...", "tempToken": "...", "userProfile": {...} }
   ```

---

## Endpoint del Callback de Pioneer

### URL: `{APP_URL}/api/social/callback`

### Archivo: `app/api/social/callback/route.ts`

Este endpoint recibe todas las redirecciones OAuth de Late.dev. Debe manejar dos escenarios:

### Escenario 1: Conexión directa (sin selección)
Query params: `?connected={platform}&profileId={id}&username={name}`
→ Mostrar página de éxito, redirigir al chat

### Escenario 2: Headless (requiere selección)
Query params incluyen `step=select_page|select_organization|select_board|select_location|select_public_profile`
→ Almacenar temporalmente los tokens
→ Mostrar UI de selección o redirigir al chat para que Pioneer maneje la selección

### Consideraciones de seguridad:
- Los `tempToken` y `connect_token` son de corta duración
- NUNCA almacenar tokens en el frontend o localStorage
- Los tokens deben procesarse server-side en el callback
- El `pendingDataToken` de LinkedIn es de un solo uso y expira en 10 minutos

---

## Multi-Page / Multi-Location Posting

Una vez conectada una cuenta de Facebook, si el usuario administra múltiples Pages, puede publicar en diferentes Pages usando `platformSpecificData`:

```json
{
  "platforms": [
    {
      "platform": "facebook",
      "accountId": "acc_123",
      "platformSpecificData": {
        "pageId": "111111111"
      }
    }
  ]
}
```

### Endpoints para listar páginas/ubicaciones de cuentas existentes:
- Facebook Pages: `GET /v1/accounts/{accountId}/facebook-page`
- LinkedIn Organizations: `GET /v1/accounts/{accountId}/linkedin-organizations`
- Google Business Locations: `GET /v1/accounts/{accountId}/gmb-locations`
