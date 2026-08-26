# Oracle Cloud Always Free deployment

Use an Ubuntu Ampere A1 instance in the tenancy home region with 2 OCPUs and
12 GB RAM. Open TCP 22, 80, and 443 in the OCI network security rules.

The deployment bundle contains the current site backend, the locally built
Oriedita MCP JAR, and its MCP adapter. The VM runs Oriedita under Xvfb, exposes
only Caddy on ports 80/443, and keeps the Groq key in a root-readable
environment file.

For a public IP such as `203.0.113.10`, use `203-0-113-10.sslip.io` as the
hostname. Then run:

```bash
scripts/deploy-oracle.sh ubuntu@203.0.113.10 203-0-113-10.sslip.io
```

After deployment, set `NEXT_PUBLIC_ORI_AI_API_URL` to the HTTPS hostname when
building the GitHub Pages and Sites frontends.

The same HTTPS hostname exposes the purpose-built Oriedita API at
`/v1/oriedita/*` and its OpenAPI document at `/openapi.json`. Set a long random
`ORI_AI_API_TOKEN` in `/etc/ori-ai/ori-ai.env` before exposing these endpoints.
