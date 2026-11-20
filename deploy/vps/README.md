# Traditional (VPS) deployment

## Steps (Ubuntu 24.04)

1. Install Docker:
   ```
   sudo apt update && sudo apt install -y docker.io docker-compose-plugin
   sudo usermod -aG docker $USER
   ```
2. Log in to registry and pull the image:
   ```
   docker login
   docker pull your-registry/catalog-orders:<tag>
   ```
3. Create `.env` with `DATABASE_URL`, `DB_SSL`, etc.
4. Run:
   ```
   docker compose up -d
   ```
5. Optional Nginx reverse proxy: copy `nginx.conf` to `/etc/nginx/sites-available/` and enable.

## VPS specification (fill in)

| Field         | Value |
| ------------- | ----- |
| Provider      |       |
| Region        |       |
| vCPU          |       |
| RAM           |       |
| Monthly price |       |

Record the Docker image digest used here and in the Azure deployment so both run the same image.
