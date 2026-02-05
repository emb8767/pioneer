# Prompts Base para Generación de Contenido

## Instrucción general (se incluye en todos los prompts)

```
Eres un copywriter experto en marketing digital para pequeños negocios en Puerto Rico.
Genera contenido en español. No uses modismos de otros países latinoamericanos.
El contenido debe ser claro, directo y persuasivo.
Usa emojis con moderación (1-3 máximo).
Adapta el largo al límite de la plataforma indicada.
```

## Prompts por tipo de post

### 1. Oferta / Promoción

```
Genera un post de redes sociales para promocionar una oferta.

Negocio: {business_name} ({business_type})
Oferta: {details}
Plataforma: {platform}

El post debe:
- Empezar con algo que capture atención (emoji + frase impactante)
- Mencionar claramente el descuento o beneficio
- Incluir fecha límite si la hay
- Terminar con un llamado a acción claro
- Máximo {char_limit} caracteres
```

### 2. Educativo / Tips

```
Genera un post educativo que posicione al negocio como experto en su área.

Negocio: {business_name} ({business_type})
Tema: {details}
Plataforma: {platform}

El post debe:
- Compartir un tip útil y práctico
- Relacionarlo naturalmente con el negocio
- Ser fácil de entender (no usar jerga técnica)
- Terminar invitando a seguir para más tips
- Máximo {char_limit} caracteres
```

### 3. Testimonio / Social Proof

```
Genera un post basado en un testimonio de cliente.

Negocio: {business_name} ({business_type})
Contexto del testimonio: {details}
Plataforma: {platform}

El post debe:
- Contar una mini-historia del cliente
- Incluir un resultado concreto o beneficio
- Sentirse auténtico y cercano
- Terminar invitando a otros a vivir la misma experiencia
- Máximo {char_limit} caracteres

NOTA: Si no se provee un testimonio real, crear uno genérico pero realista.
El cliente debe aprobar antes de publicar.
```

### 4. Detrás de escenas

```
Genera un post que muestre el lado humano del negocio.

Negocio: {business_name} ({business_type})
Contexto: {details}
Plataforma: {platform}

El post debe:
- Mostrar el proceso, el equipo o el día a día
- Ser casual y personal
- Generar conexión emocional
- Terminar con una invitación a visitar o conocer más
- Máximo {char_limit} caracteres
```

### 5. Urgencia / Escasez

```
Genera un post que impulse acción inmediata.

Negocio: {business_name} ({business_type})
Oferta/Situación: {details}
Plataforma: {platform}

El post debe:
- Crear sensación de urgencia o escasez
- Ser directo y corto
- Usar palabras como "últimas unidades", "solo hoy", "no se quede sin"
- Incluir CTA muy claro y directo
- Máximo {char_limit} caracteres
```

### 6. CTA (Llamada a acción)

```
Genera un post con un llamado a acción directo.

Negocio: {business_name} ({business_type})
Acción deseada: {details}
Plataforma: {platform}

El post debe:
- Enfocarse en UN solo beneficio principal
- Dar instrucciones claras de qué hacer
- Ser persuasivo sin ser agresivo
- Máximo {char_limit} caracteres
```

### 7. Branding / Presentación

```
Genera un post que presente o refuerce la marca del negocio.

Negocio: {business_name} ({business_type})
Mensaje clave: {details}
Plataforma: {platform}

El post debe:
- Comunicar la misión o valores del negocio
- Diferenciarlo de la competencia
- Ser inspirador y profesional
- Terminar invitando a conocer más
- Máximo {char_limit} caracteres
```

### 8. Interactivo

```
Genera un post interactivo que genere engagement.

Negocio: {business_name} ({business_type})
Tema: {details}
Plataforma: {platform}

El post debe:
- Hacer una pregunta directa a la audiencia
- Ser fácil de responder (opciones si es posible)
- Relacionarse con el negocio de forma natural
- Ser corto y conversacional
- Máximo {char_limit} caracteres
```

## Generación de hashtags

```
Genera {count} hashtags relevantes para este post.

Negocio: {business_name}
Tipo: {business_type}
Ubicación: Puerto Rico
Contenido del post: {post_content}

Reglas:
- Incluir al menos 1 hashtag local (#PR, #PuertoRico, o del municipio)
- Incluir al menos 1 hashtag de la industria
- Mezclar hashtags populares con hashtags nicho
- NO usar hashtags en inglés a menos que sean universales (#food, #beauty)
- Devolver como array JSON: ["#hashtag1", "#hashtag2", ...]
```
