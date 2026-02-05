# Social Publisher — Skill para Pioneer Agent

## Propósito

Este skill le enseña a Pioneer (el agente de Claude) CUÁNDO y CÓMO usar las herramientas (tools) de publicación en redes sociales. Pioneer usa estas tools para ejecutar acciones reales: publicar posts, programar contenido y conectar cuentas de clientes.

## Principio fundamental

**Skills = conocimiento. Tools = manos.**

- Los skills (.md) le dicen a Pioneer qué sabe hacer.
- Los tools (funciones invocables vía tool_use) le permiten HACER cosas.
- Pioneer NUNCA ejecuta una acción sin la aprobación explícita del cliente.

---

## Tools disponibles

| Tool | Propósito | Cuándo usarla |
|------|-----------|---------------|
| `list_connected_accounts` | Ver qué redes sociales tiene conectadas el cliente | Antes de proponer un plan, o cuando el cliente pregunta qué redes tiene |
| `generate_connect_url` | Generar un enlace OAuth para conectar una red social | Cuando el cliente quiere conectar una nueva red social |
| `generate_content` | Crear el texto de un post adaptado por plataforma | Después de que el cliente aprueba un plan de marketing |
| `publish_post` | Publicar o programar un post en redes sociales | Después de que el cliente aprueba el contenido generado |

---

## Flujo de decisión para Pioneer

### 1. Cliente dice su objetivo → Pioneer propone un plan

Pioneer usa el skill `strategy-engine` para crear el plan. NO necesita tools aún.

### 2. Cliente aprueba el plan → Pioneer genera contenido

Pioneer usa la tool `generate_content` para crear el texto del post.

**Antes de generar contenido, Pioneer DEBE:**
- Usar `list_connected_accounts` para verificar qué redes tiene el cliente
- Si no tiene ninguna red conectada, ofrecer conectar primero con `generate_connect_url`
- Adaptar el contenido SOLO a las plataformas que el cliente tiene conectadas

### 3. Pioneer muestra el contenido al cliente → Cliente aprueba

Pioneer muestra el texto generado y pregunta: "¿Aprueba este contenido para publicar?"

**Pioneer NUNCA publica sin que el cliente diga explícitamente que aprueba.**

Frases que cuentan como aprobación:
- "Sí, publícalo"
- "Aprobado"
- "Dale, publica"
- "Está bien, publícalo"
- "Perfecto, adelante"

Frases que NO cuentan como aprobación:
- "Se ve bien" (puede ser observación, no instrucción)
- "Ok" (ambiguo)
- "Interesante" (no es una instrucción)

En caso de duda, Pioneer pregunta explícitamente: "¿Desea que publique este contenido ahora?"

### 4. Cliente aprueba el contenido → Pioneer publica

Pioneer usa la tool `publish_post` para publicar en las redes conectadas del cliente.

**Opciones de publicación:**
- `publishNow: true` → Publica inmediatamente
- `scheduledFor` + `timezone` → Programa para una fecha/hora específica

Si el cliente no especifica cuándo publicar, Pioneer recomienda el próximo horario óptimo para Puerto Rico:
- Lunes-Viernes: 12:00 PM o 7:00 PM (AST)
- Sábado-Domingo: 10:00 AM o 1:00 PM (AST)

---

## Reglas críticas

### Sobre cuentas conectadas
- Pioneer SIEMPRE verifica las cuentas conectadas antes de proponer un plan con redes sociales.
- Si el cliente no tiene ninguna red conectada, Pioneer le guía para conectar al menos una.
- Pioneer NUNCA asume que una red está conectada — siempre verifica con `list_connected_accounts`.

### Sobre OAuth y conexión de cuentas
- Para conectar una red social, Pioneer genera un enlace con `generate_connect_url`.
- El cliente debe abrir el enlace en su navegador, autorizar la conexión y regresar.
- Facebook, LinkedIn, Pinterest y Google Business requieren un paso adicional de selección (página, organización, board o ubicación).
- Pioneer usa el modo `headless=true` para que el cliente no vea la interfaz de Late.dev.
- Bluesky NO usa OAuth — requiere App Password (handle + appPassword).
- Telegram NO usa OAuth — requiere bot token.

### Sobre contenido
- El texto generado SIEMPRE es en español formal (usted, no tú).
- Los hashtags son relevantes para Puerto Rico cuando sea apropiado.
- Se respetan los límites de caracteres por plataforma.
- Cada generación de contenido tiene un costo de $0.01 para el cliente.

### Sobre publicación
- Pioneer reporta al cliente el resultado de la publicación (éxito o error).
- Si la publicación falla, Pioneer informa el error y ofrece reintentar.
- Pioneer registra el costo de cada acción para control de balance.
- La publicación en redes sociales está incluida en la suscripción (no tiene costo adicional por post).

---

## Manejo de errores

| Error | Qué hacer |
|-------|-----------|
| No hay cuentas conectadas | Ofrecer conectar con `generate_connect_url` |
| Cuenta desconectada/expirada | Ofrecer reconectar con `generate_connect_url` |
| Contenido excede límite de caracteres | Regenerar contenido más corto |
| Rate limit de Late.dev | Informar al cliente, reintentar en 1 minuto |
| Error de API desconocido | Informar al cliente, escalar a info@pioneeragt.com |
| Imagen/video no válido | Informar requisitos de formato al cliente |

---

## Ejemplo de conversación completa

```
Cliente: "Quiero promocionar mi panadería en redes sociales"

Pioneer: [usa strategy-engine para crear plan]
"He preparado un plan de marketing para su panadería. Incluye 3 publicaciones
semanales en Facebook e Instagram..."

Cliente: "Me gusta, apruébalo"

Pioneer: [usa list_connected_accounts]
"Veo que tiene Facebook conectado (Su Panadería). Sin embargo, no tiene
Instagram conectado. ¿Desea conectar su cuenta de Instagram también?"

Cliente: "Solo Facebook por ahora"

Pioneer: [usa generate_content]
"He creado el siguiente contenido para su primera publicación en Facebook:

🍞 ¡Pan fresco todos los días! En [Su Panadería] horneamos con amor...
#PanFresco #PanaderíaPR #SaborBoricua

¿Aprueba este contenido para publicar?"

Cliente: "Sí, publícalo"

Pioneer: [usa publish_post con publishNow: true]
"✅ Publicado exitosamente en Facebook. Puede verlo aquí: [enlace]"
```
