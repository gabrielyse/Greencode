# Arquitetura de segurança e resiliência

## Proteção dos dados

Os arquivos de credenciais, organizações, lotes e equipamentos têm extensão `.enc` e são cifrados individualmente com **AES-256-GCM**. AES-256 é um padrão amplamente revisado; GCM acrescenta autenticação, portanto alteração do conteúdo ou uso da chave errada falha na leitura. Cada cifragem recebe IV aleatório de 96 bits. A chave de 256 bits é criada com `randomBytes` durante o provisionamento e fica em `master.config.json`; esse arquivo é o material raiz e deve ser protegido por permissões do sistema e backup seguro. O cadastro inicial é registrado nele pelo nome e a credencial completa permanece no arquivo cifrado separado.

Senhas não são reversíveis: são armazenadas como hash **SHA-256** em `credentials.enc`, e a comparação usa `timingSafeEqual`. Em uma evolução de produção, SHA-256 deve ser substituído por Argon2id ou scrypt com salt por usuário; foi mantido SHA-256 por ser a exigência explícita da atividade. A sessão interativa expira após 30 minutos sem comando.

Cada alteração é gravada no journal AES-GCM antes da conclusão da operação de estado. Arquivos de estado são escritos em temporário no mesmo diretório e renomeados atomicamente, evitando arquivo parcialmente escrito. O journal é rotacionado ao alcançar 10 MiB. Arquivos rotacionados só são removidos após 180 dias; o journal vigente nunca é removido pela rotina de retenção.

## Falhas cobertas

- **Interrupção na gravação:** o arquivo temporário não substitui o estado anterior; o `rename` atômico só ocorre ao fim.
- **Arquivo adulterado/chave inválida:** a verificação GCM impede a leitura e a aplicação informa corrupção, sem sobrescrever os dados.
- **Desmonte sem triagem:** a regra de negócio rejeita a movimentação.
- **Queda de duas categorias físicas:** a movimentação é rejeitada sem justificativa.
- **CNPJ, data de lote e duplicidades inválidos:** são rejeitados antes de persistir.
- **Acesso indevido:** permissões são checadas no serviço, não apenas no menu CLI.

