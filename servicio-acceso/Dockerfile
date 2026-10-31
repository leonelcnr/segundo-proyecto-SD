
# 1. Partimos de una imagen oficial y liviana de Python
FROM python:3.11-slim

# 2. Establecemos la carpeta de trabajo dentro del contenedor
WORKDIR /app

# 3. Copiamos e instalamos las dependencias
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 4. Copiamos el resto del código (servicio.py, init_db.py, datos.db, etc.)
COPY . .

# 5. Comando que se ejecuta al iniciar el contenedor
CMD ["python", "servicio.py"]
