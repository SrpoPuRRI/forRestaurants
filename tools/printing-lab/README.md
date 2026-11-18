# Laboratorio Epson virtual

Este laboratorio prueba la cola real de Supabase sin instalar ni ejecutar
BPrint.

Inicia impresoras Epson virtuales en TCP local, por ejemplo:

- Epson TM-T20IV, `127.0.0.1:9100`
- Epson TM-T88VII, `127.0.0.1:9101`

El laboratorio no inicia sesión y no registra dispositivos. Esa responsabilidad
pertenece exclusivamente a BPrint:

1. BPrint inicia sesión como administrador.
2. BPrint descubre una impresora real o virtual.
3. BPrint llama a la provisión segura y registra/actualiza `printing_devices`.
4. BPrint guarda el UUID y el token localmente.

Este script lee esas credenciales desde los archivos preparados por BPrint:

```text
%LOCALAPPDATA%\BPrint\connection.json
%LOCALAPPDATA%\BPrint\printers.json
```

`connection.json` contiene los UUID y tokens generados por BPrint.
`printers.json` contiene las colas Epson seleccionadas y sus metadatos.

Ejecuta el laboratorio una vez que BPrint haya registrado y emitido las
credenciales de los dispositivos:

```powershell
Set-Location "F:\PROYECTOS\forRestaurants"
powershell.exe -ExecutionPolicy Bypass -File `
  .\tools\printing-lab\epson-print-lab.ps1
```

Cada dispositivo registrado debe enlazarse desde Configuración del POS al punto
correspondiente.

Los tickets recibidos se guardan en:

```text
tools\printing-lab\output\<modelo>-<puerto>\
```

El script usa:

- `operate_printing_device` para latido, reclamo y confirmación;
- TCP crudo ESC/POS con bytes de inicialización y corte;
- los formatos y rutas configurados en el POS.

El laboratorio no usa `printing-device-provision`, no recibe credenciales de
usuario y no necesita iniciar sesión.
