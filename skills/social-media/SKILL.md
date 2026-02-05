# Social Media Skill (Late.dev)

## Descripción

Este skill maneja la publicación de contenido en redes sociales a través de la API de Late.dev. Permite publicar en 13 plataformas con una sola API.

## Archivos de este skill

| Archivo | Propósito |
|---------|-----------|
| `SKILL.md` | Este archivo - integración completa con Late.dev |

## API de Late.dev - Referencia

### Base URL
```
https://getlate.dev/api/v1
```

### Autenticación
```
Authorization: Bearer LATE_API_KEY
```

### Conceptos clave

| Concepto | Descripción |
|----------|-------------|
| **Profile** | Contenedor que agrupa cuentas sociales (como "marcas" o "proyectos") |
| **Account** | Cuenta de red social conectada (ej: tu Instagram, tu Facebook page) |
| **Post** | Contenido a publicar. Un post puede ir a múltiples plataformas |
| **Queue** | Horario de publicación recurrente (opcional) |

### Rate Limits

| Plan | Requests por minuto |
|------|---------------------|
| Free | 60 |
| Build | 120 |
| Accelerate | 600 |

## Endpoints que Pioneer usa

### 1. Listar perfiles
```
GET /v1/profiles
```
**Uso:** Ver los perfiles (marcas) del cliente al hacer onboarding.

### 2. Crear perfil
```
POST /v1/profiles
Body: { "name": "Mi Negocio", "description": "Descripción" }
```
**Uso:** Crear un perfil para un nuevo cliente.

**Response:**
```json
{
  "message": "Profile created successfully",
  "profile": {
    "_id": "prof_abc123",
    "name": "Mi Negocio",
    "description": "Descripción",
    "createdAt": "2024-01-15T10:00:00.000Z"
  }
}
```

### 3. Conectar cuenta social (OAuth)
```
GET /v1/connect/{platform}?profileId={profileId}
```
**Plataformas válidas:** twitter, instagram, facebook, linkedin, tiktok, youtube, pinterest, reddit, bluesky, threads, googlebusiness, telegram, snapchat

**Response:**
```json
{
  "authUrl": "https://..."
}
```
**Uso:** Devuelve una URL de OAuth. El cliente debe abrir esa URL en su navegador para autorizar.

**Excepción - Bluesky (sin OAuth):**
```
POST /v1/connect/bluesky
Body: {
  "profileId": "prof_abc123",
  "handle": "usuario.bsky.social",
  "appPassword": "xxxx-xxxx-xxxx-xxxx"
}
```

### 4. Listar cuentas conectadas
```
GET /v1/accounts
```
**Uso:** Ver qué cuentas tiene conectadas el cliente.

**Response:**
```json
{
  "accounts": [
    {
      "_id": "acc_xyz789",
      "platform": "twitter",
      "username": "minegocio",
      "profileId": "prof_abc123"
    }
  ]
}
```

### 5. Crear post (ENDPOINT PRINCIPAL)
```
POST /v1/posts
Body: {
  "content": "Texto del post",
  "platforms": [
    {
      "platform": "instagram",
      "accountId": "acc_xyz789"
    },
    {
      "platform": "facebook",
      "accountId": "acc_abc456"
    }
  ],
  "scheduledFor": "2026-02-10T12:00:00",
  "timezone": "America/Puerto_Rico"
}
```

**Opciones adicionales:**
- `publishNow: true` — Publicar inmediatamente en vez de programar
- `mediaItems: [{ type: "image", url: "https://..." }]` — Adjuntar imágenes/videos
- Sin `scheduledFor` ni `publishNow` — Se guarda como borrador

**Response:**
```json
{
  "message": "Post scheduled successfully",
  "post": {
    "_id": "post_123abc",
    "content": "Texto del post",
    "status": "scheduled",
    "scheduledFor": "2026-02-10T16:00:00.000Z",
    "platforms": [
      {
        "platform": "instagram",
        "accountId": "acc_xyz789",
        "status": "pending"
      }
    ]
  }
}
```

### 6. Listar posts
```
GET /v1/posts
```
**Uso:** Ver historial de posts del cliente.

### 7. Obtener post específico
```
GET /v1/posts/{postId}
```

### 8. Actualizar post
```
PATCH /v1/posts/{postId}
Body: { "content": "Texto actualizado" }
```

### 9. Eliminar post
```
DELETE /v1/posts/{postId}
```

## Flujo de publicación en Pioneer

```
1. Cliente aprueba un plan
        ↓
2. Content-writer genera el texto del post
        ↓
3. Pioneer muestra el contenido al cliente para revisión
        ↓
4. Cliente aprueba el contenido
        ↓
5. Pioneer verifica cuentas conectadas (GET /v1/accounts)
        ↓
6. Si no hay cuentas → dirigir a conectar (GET /v1/connect/{platform})
        ↓
7. Pioneer publica o programa el post (POST /v1/posts)
        ↓
8. Pioneer confirma al cliente con ID del post y estado
```

## Manejo de errores

| Código HTTP | Significado | Acción de Pioneer |
|-------------|-------------|-------------------|
| 200 | Éxito | Confirmar al cliente |
| 400 | Request inválido | Revisar datos y reintentar |
| 401 | API key inválida | Escalar a soporte técnico |
| 403 | Sin permisos | Verificar plan de Late.dev |
| 404 | Recurso no encontrado | Verificar IDs |
| 429 | Rate limit excedido | Esperar y reintentar |
| 500 | Error de Late.dev | Reintentar, si persiste escalar |

**Mensaje al cliente en caso de error:**
```
"Hubo un problema al publicar su contenido. Estoy reintentando...
Si el problema persiste, contacte a info@pioneeragt.com."
```

## Horarios para Puerto Rico

**Timezone:** `America/Puerto_Rico` (AST, UTC-4, no tiene horario de verano)

| Día | Horario óptimo | Formato ISO |
|-----|---------------|-------------|
| Lun-Vie | 12:00 PM | T12:00:00 |
| Lun-Vie | 7:00 PM | T19:00:00 |
| Sáb-Dom | 10:00 AM | T10:00:00 |
| Sáb-Dom | 1:00 PM | T13:00:00 |

## Dependencias

| Servicio | Para qué |
|----------|----------|
| Late.dev API | Publicación en redes sociales |
| `content-writer` | Genera el texto a publicar |
| `image-generator` | Genera imágenes para posts (futuro - Fase C) |
| `pioneer-core` | Reglas de comportamiento |

## Variables de entorno requeridas

```
LATE_API_KEY=sk_...
```

## Costos

- Publicación en redes: Incluido en suscripción de Late.dev
- Plan recomendado para iniciar: Build ($19/mes) = 10 perfiles, 120 posts/mes
- Para Pioneer, el costo de publicación se incluye en la suscripción del cliente ($29/mes)
