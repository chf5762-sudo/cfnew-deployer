import { copyFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const dirname = import.meta.dirname;

// 从命令行读取参数
const args = process.argv.slice(2);
const apiToken = args[0];
const accountId = args[1];
const targetProject = args[2] || 'edge-fast-cache';
const kvNamespaceId = args[3] || 'e4a6bac15ba548a8b3d525ec7155bbe7';
// 已经硬编码在源码模版中的 UUID
const uuid = '615b6557-e05b-4b83-9922-bf1ef35b4681'; 

if (!apiToken || !accountId) {
  console.log('\n❌ 错误: 缺少必要参数！');
  console.log('用法: node deploy-quick.mjs <CF_API_TOKEN> <CF_ACCOUNT_ID> [项目名称] [KV空间ID]');
  console.log('示例: node deploy-quick.mjs cfat_xxxxxx 6a69c4bb... my-proxy-node\n');
  process.exit(1);
}

const sourceFile = resolve(dirname, 'public', 'sources', '少年你相信光吗');
const tempDir = join(tmpdir(), `wrangler-deploy-${Date.now()}`);

async function deleteProjectIfExists() {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${targetProject}`;
  try {
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${apiToken}` }
    });
    const data = await res.json();
    return data.success;
  } catch {
    return false;
  }
}

async function createProjectConfig() {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects`;
  const body = {
    name: targetProject,
    production_branch: 'main',
    deployment_configs: {
      production: {
        compatibility_date: '2026-01-20',
        env_vars: {
          u: { type: 'plain_text', value: uuid }
        },
        kv_namespaces: {
          C: { namespace_id: kvNamespaceId }
        }
      },
      preview: {
        compatibility_date: '2026-01-20',
        env_vars: {
          u: { type: 'plain_text', value: uuid }
        },
        kv_namespaces: {
          C: { namespace_id: kvNamespaceId }
        }
      }
    }
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    return data.success;
  } catch {
    return false;
  }
}

async function main() {
  console.log(`\n🚀 开始部署项目 [${targetProject}]...`);
  
  // 1. 尝试删除已有的同名项目以防冲突
  await deleteProjectIfExists();

  // 2. 创建并配置项目
  const created = await createProjectConfig();
  if (!created) {
    console.log('❌ 项目初始化创建失败，请检查您的 Token 权限或 Account ID！');
    return;
  }
  console.log('✅ Cloudflare 项目创建与配置绑定成功！');

  try {
    await mkdir(tempDir, { recursive: true });
    
    // 3. 复制混淆后的源码并写入 wrangler.toml
    await copyFile(sourceFile, join(tempDir, '_worker.js'));
    const tomlContent = `name = "${targetProject}"
compatibility_date = "2026-01-20"
pages_build_output_dir = "."

[vars]
u = "${uuid}"

[[kv_namespaces]]
binding = "C"
id = "${kvNamespaceId}"
`;
    await writeFile(join(tempDir, 'wrangler.toml'), tomlContent, 'utf8');

    // 4. 运行 wrangler 进行上传部署
    console.log('⏳ 正在上传发布代码到 Cloudflare Pages...');
    const child = spawn('npx', [
      '-y', 'wrangler', 'pages', 'deploy', tempDir,
      '--project-name', targetProject,
      '--branch', 'main',
      '--commit-dirty', 'true',
      '--no-bundle'
    ], {
      env: {
        ...process.env,
        CLOUDFLARE_API_TOKEN: apiToken,
        CLOUDFLARE_ACCOUNT_ID: accountId
      },
      shell: true
    });

    child.stdout.on('data', data => {
      process.stdout.write(data);
    });

    child.stderr.on('data', data => {
      process.stderr.write(data);
    });

    child.on('close', async code => {
      // 清理临时目录
      await rm(tempDir, { recursive: true, force: true });
      
      if (code === 0) {
        console.log(`\n🎉 部署大成功！`);
        console.log(`🔗 您的节点订阅链接为: https://${targetProject}.pages.dev/${uuid}\n`);
      } else {
        console.log(`\n❌ 部署失败，退出码: ${code}\n`);
      }
    });

  } catch (err) {
    console.log('❌ 发生异常:', err);
    await rm(tempDir, { recursive: true, force: true });
  }
}

main();
