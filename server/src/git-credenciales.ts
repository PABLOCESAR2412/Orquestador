// El token solo vive en el entorno del proceso Git. El helper se restringe a github.com y no
// incorpora credenciales en la URL, los argumentos, la configuración del repo ni la salida.
export function opcionesDeCredenciales(token: string | null): {
  args: string[];
  env: Record<string, string>;
} {
  const args = ["-c", "credential.helper="];
  const env: Record<string, string> = {};
  if (token) {
    args.push(
      "-c",
      'credential.https://github.com.helper=!f() { printf "username=x-access-token\\npassword=%s\\n" "$TELO_GIT_TOKEN"; }; f',
    );
    env.TELO_GIT_TOKEN = token;
  }
  return { args, env };
}
