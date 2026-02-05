# Social Publisher — Definición de Tools

## Formato de tools para Claude API

Estas son las definiciones de tools que se agregan al llamado de Claude API en `app/api/chat/route.ts`. Cada tool tiene un `name`, `description` e `input_schema` en formato JSON Schema.

---

## Tool 1: `list_connected_accounts`

### Descripción
Lista las cuentas de redes sociales conectadas del cliente. Pioneer debe llamar esta tool antes de proponer planes de publicación o antes de publicar contenido.

### Definición para Claude API
```json
{
  "name": "list_connected_accounts",
  "description": "Lista las cuentas de redes sociales conectadas del cliente. Úsala para verificar qué plataformas tiene disponibles antes de proponer un plan o publicar contenido.",
  "input_schema": {
    "type": "object",
    "properties": {
      "profile_id": {
        "type": "string",
        "description": "ID del perfil del cliente en Late.dev. Si no se proporciona, usa el perfil por defecto."
      }
    },
    "required": []
  }
}
```

### Implementación en route.ts
Cuando Claude invoca esta tool, el código de route.ts debe:
1. Llamar a `GET https://getlate.dev/api/v1/accounts` (con `?profileId=X` si se proporcionó)
2. Devolver la lista de cuentas con: `_id`, `platform`, `username`, `displayName`, `isActive`

### Respuesta esperada (tool_result)
```json
{
  "accounts": [
    {
      "_id": "6984c5bfbe4471a4ab75d282",
      "platform": "facebook",
      "username": "supanaderia",
      "displayName": "Su Panadería",
      "isActive": true
    }
  ]
}
```

---

## Tool 2: `generate_connect_url`

### Descripción
Genera un enlace de autorización OAuth para que el cliente conecte una nueva red social. El cliente debe abrir este enlace en su navegador.

### Definición para Claude API
```json
{
  "name": "generate_connect_url",
  "description": "Genera un enlace OAuth para conectar una red social del cliente. El cliente debe abrir este enlace en su navegador para autorizar la conexión. Úsala cuando el cliente quiere conectar una nueva plataforma.",
  "input_schema": {
    "type": "object",
    "properties": {
      "platform": {
        "type": "string",
        "enum": ["facebook", "instagram", "linkedin", "twitter", "tiktok", "youtube", "threads", "reddit", "pinterest", "bluesky", "googlebusiness", "telegram", "snapchat"],
        "description": "La plataforma de red social a conectar"
      },
      "profile_id": {
        "type": "string",
        "description": "ID del perfil del cliente en Late.dev"
      }
    },
    "required": ["platform", "profile_id"]
  }
}
```

### Implementación en route.ts
Cuando Claude invoca esta tool, el código de route.ts debe:

**Para la mayoría de plataformas (OAuth):**
1. Llamar a `GET https://getlate.dev/api/v1/connect/{platform}?profileId={profile_id}&redirect_url={callback_url}&headless=true`
2. Devolver el `authUrl` para que el cliente lo abra en su navegador

**Para Bluesky (App Password, NO OAuth):**
1. Pedir al cliente su handle y App Password
2. Llamar a `POST https://getlate.dev/api/v1/connect/bluesky` con `{ profileId, handle, appPassword }`
3. Devolver la confirmación de conexión

**Para Telegram (Bot Token, NO OAuth):**
1. Pedir al cliente su bot token
2. Seguir el flujo específico de Telegram

### Respuesta esperada (tool_result)
```json
{
  "authUrl": "https://www.facebook.com/v21.0/dialog/oauth?client_id=...",
  "platform": "facebook",
  "instructions": "Abra este enlace en su navegador para autorizar la conexión. Después de autorizar, regrese aquí."
}
```

### Callback URL
El `redirect_url` para el OAuth debe ser: `{APP_URL}/api/social/callback`
- En desarrollo: `http://localhost:3000/api/social/callback`
- En producción: `https://pioneer-five.vercel.app/api/social/callback`

---

## Tool 3: `generate_content`

### Descripción
Genera el texto de un post de redes sociales adaptado a cada plataforma. Usa Claude API internamente para crear contenido relevante.

### Definición para Claude API
```json
{
  "name": "generate_content",
  "description": "Genera el texto de un post de redes sociales adaptado a las plataformas del cliente. Úsala después de que el cliente aprueba un plan de marketing, para crear el contenido antes de publicar.",
  "input_schema": {
    "type": "object",
    "properties": {
      "business_name": {
        "type": "string",
        "description": "Nombre del negocio del cliente"
      },
      "business_type": {
        "type": "string",
        "description": "Tipo de negocio (restaurante, tienda, salón, etc.)"
      },
      "post_type": {
        "type": "string",
        "enum": ["offer", "educational", "testimonial", "behind-scenes", "urgency", "cta", "branding", "interactive"],
        "description": "Tipo de post a generar"
      },
      "details": {
        "type": "string",
        "description": "Detalles específicos del post (qué promocionar, qué tema, etc.)"
      },
      "platforms": {
        "type": "array",
        "items": {
          "type": "string",
          "enum": ["facebook", "instagram", "linkedin", "twitter", "tiktok", "youtube", "threads", "reddit", "pinterest", "bluesky", "googlebusiness", "telegram", "snapchat"]
        },
        "description": "Plataformas para las que generar contenido"
      },
      "tone": {
        "type": "string",
        "enum": ["professional", "casual", "excited", "informative", "urgent"],
        "description": "Tono del contenido",
        "default": "professional"
      },
      "include_hashtags": {
        "type": "boolean",
        "description": "Si incluir hashtags relevantes para PR",
        "default": true
      }
    },
    "required": ["business_name", "business_type", "post_type", "details", "platforms"]
  }
}
```

### Implementación en route.ts
Cuando Claude invoca esta tool, el código de route.ts debe:
1. Llamar al endpoint interno `POST /api/content` con los parámetros
2. Devolver el contenido generado por plataforma

### Respuesta esperada (tool_result)
```json
{
  "content": {
    "facebook": {
      "text": "🍞 ¡Pan fresco todos los días! En Su Panadería horneamos con amor desde las 5 AM...\n\n#PanFresco #PanaderíaPR #SaborBoricua",
      "character_count": 145,
      "character_limit": 63206
    }
  },
  "cost": 0.01,
  "post_type": "offer"
}
```

---

## Tool 4: `publish_post`

### Descripción
Publica o programa un post en las redes sociales conectadas del cliente. Esta tool SOLO se usa después de que el cliente aprueba el contenido explícitamente.

### Definición para Claude API
```json
{
  "name": "publish_post",
  "description": "Publica o programa un post en las redes sociales del cliente. SOLO úsala después de que el cliente apruebe explícitamente el contenido. Puede publicar inmediatamente o programar para una fecha futura.",
  "input_schema": {
    "type": "object",
    "properties": {
      "content": {
        "type": "string",
        "description": "El texto del post a publicar"
      },
      "platforms": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "platform": {
              "type": "string",
              "enum": ["facebook", "instagram", "linkedin", "twitter", "tiktok", "youtube", "threads", "reddit", "pinterest", "bluesky", "googlebusiness", "telegram", "snapchat"]
            },
            "account_id": {
              "type": "string",
              "description": "ID de la cuenta conectada en Late.dev"
            }
          },
          "required": ["platform", "account_id"]
        },
        "description": "Lista de plataformas y sus account IDs donde publicar"
      },
      "publish_now": {
        "type": "boolean",
        "description": "Si es true, publica inmediatamente. Si es false, debe proporcionar scheduled_for.",
        "default": false
      },
      "scheduled_for": {
        "type": "string",
        "description": "Fecha y hora para programar la publicación en formato ISO 8601 (ej: 2026-02-06T12:00:00)"
      },
      "timezone": {
        "type": "string",
        "description": "Zona horaria para la programación",
        "default": "America/Puerto_Rico"
      },
      "media_urls": {
        "type": "array",
        "items": {
          "type": "string"
        },
        "description": "URLs de imágenes o videos a incluir en el post (opcional)"
      }
    },
    "required": ["content", "platforms"]
  }
}
```

### Implementación en route.ts
Cuando Claude invoca esta tool, el código de route.ts debe:
1. Construir el body para Late.dev API:
```javascript
const body = {
  content: input.content,
  platforms: input.platforms.map(p => ({
    platform: p.platform,
    accountId: p.account_id
  })),
  // Publicación inmediata
  ...(input.publish_now && { publishNow: true }),
  // Publicación programada
  ...(input.scheduled_for && {
    scheduledFor: input.scheduled_for,
    timezone: input.timezone || 'America/Puerto_Rico'
  }),
  // Media (opcional)
  ...(input.media_urls?.length && {
    mediaItems: input.media_urls.map(url => ({
      type: url.match(/\.(mp4|mov|avi|webm)$/i) ? 'video' : 'image',
      url
    }))
  })
};
```
2. Llamar a `POST https://getlate.dev/api/v1/posts` con el body
3. Devolver el resultado

### Respuesta esperada — Publicación inmediata (tool_result)
```json
{
  "success": true,
  "post_id": "65f1c0a9e2b5af0012ab34cd",
  "status": "published",
  "platforms": [
    {
      "platform": "facebook",
      "status": "published",
      "post_url": "https://facebook.com/supanaderia/posts/123456"
    }
  ]
}
```

### Respuesta esperada — Publicación programada (tool_result)
```json
{
  "success": true,
  "post_id": "65f1c0a9e2b5af0012ab34cd",
  "status": "scheduled",
  "scheduled_for": "2026-02-06T12:00:00",
  "timezone": "America/Puerto_Rico",
  "platforms": [
    {
      "platform": "facebook",
      "status": "pending"
    }
  ]
}
```

---

## Resumen del loop de tool_use en route.ts

El flujo en `app/api/chat/route.ts` debe implementar el siguiente loop:

```
1. Recibir mensajes del frontend
2. Enviar a Claude API con system prompt + tools
3. Si Claude responde con stop_reason="end_turn" → devolver texto al frontend
4. Si Claude responde con stop_reason="tool_use" →
   a. Extraer el tool_use block (name + input)
   b. Ejecutar la acción real (llamar a Late.dev, /api/content, etc.)
   c. Crear un tool_result message con el resultado
   d. Enviar de vuelta a Claude API (messages + tool_result)
   e. Repetir desde paso 3
5. Máximo 5 iteraciones del loop para prevenir loops infinitos
```

### Formato de tool_use en la respuesta de Claude
```json
{
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "Voy a verificar sus cuentas conectadas..."
    },
    {
      "type": "tool_use",
      "id": "toolu_01abc123",
      "name": "list_connected_accounts",
      "input": {}
    }
  ]
}
```

### Formato de tool_result para enviar de vuelta
```json
{
  "role": "user",
  "content": [
    {
      "type": "tool_result",
      "tool_use_id": "toolu_01abc123",
      "content": "{\"accounts\": [{\"_id\": \"abc\", \"platform\": \"facebook\", ...}]}"
    }
  ]
}
```
