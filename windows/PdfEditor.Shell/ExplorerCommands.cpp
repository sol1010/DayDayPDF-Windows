#include <windows.h>
#include <shobjidl_core.h>

#include <algorithm>
#include <atomic>
#include <cstring>
#include <cwctype>
#include <new>
#include <string>
#include <utility>
#include <vector>

namespace
{
constexpr GUID MergeCommandClsid =
    {0xd1c90688, 0x87d6, 0x4494, {0x95, 0xf3, 0x2f, 0xba, 0x07, 0x3e, 0xc2, 0x77}};

HMODULE moduleHandle = nullptr;
std::atomic<long> moduleReferences = 0;

HRESULT CopyString(const std::wstring& value, PWSTR* destination)
{
    if (destination == nullptr)
    {
        return E_POINTER;
    }

    const auto bytes = (value.size() + 1) * sizeof(wchar_t);
    auto* copy = static_cast<PWSTR>(CoTaskMemAlloc(bytes));
    if (copy == nullptr)
    {
        return E_OUTOFMEMORY;
    }

    memcpy(copy, value.c_str(), bytes);
    *destination = copy;
    return S_OK;
}

std::wstring GetSiblingExecutablePath()
{
    std::vector<wchar_t> buffer(32768);
    const DWORD length = GetModuleFileNameW(moduleHandle, buffer.data(), static_cast<DWORD>(buffer.size()));
    if (length == 0 || length >= buffer.size())
    {
        return {};
    }

    std::wstring path(buffer.data(), length);
    const auto separator = path.find_last_of(L"\\/");
    if (separator == std::wstring::npos)
    {
        return {};
    }

    path.resize(separator + 1);
    path += L"PdfEditor.Preview.exe";
    return path;
}

bool IsPdfPath(const std::wstring& path)
{
    constexpr wchar_t extension[] = L".pdf";
    if (path.size() < std::size(extension) - 1)
    {
        return false;
    }

    const auto offset = path.size() - (std::size(extension) - 1);
    return std::equal(
        path.begin() + static_cast<std::wstring::difference_type>(offset),
        path.end(),
        extension,
        [](wchar_t left, wchar_t right) { return std::towlower(left) == right; });
}

std::vector<std::wstring> GetSelectedPdfPaths(IShellItemArray* selection)
{
    std::vector<std::wstring> paths;
    if (selection == nullptr)
    {
        return paths;
    }

    DWORD count = 0;
    if (FAILED(selection->GetCount(&count)))
    {
        return paths;
    }

    paths.reserve(count);
    for (DWORD index = 0; index < count; ++index)
    {
        IShellItem* item = nullptr;
        if (FAILED(selection->GetItemAt(index, &item)))
        {
            continue;
        }

        PWSTR rawPath = nullptr;
        const HRESULT result = item->GetDisplayName(SIGDN_FILESYSPATH, &rawPath);
        item->Release();

        if (SUCCEEDED(result) && rawPath != nullptr)
        {
            std::wstring path(rawPath);
            CoTaskMemFree(rawPath);
            if (IsPdfPath(path))
            {
                paths.push_back(std::move(path));
            }
        }
    }

    return paths;
}

std::wstring QuoteArgument(const std::wstring& argument)
{
    std::wstring quoted = L"\"";
    std::size_t backslashes = 0;

    for (const wchar_t character : argument)
    {
        if (character == L'\\')
        {
            ++backslashes;
            continue;
        }

        if (character == L'\"')
        {
            quoted.append(backslashes * 2 + 1, L'\\');
            quoted += L'\"';
            backslashes = 0;
            continue;
        }

        quoted.append(backslashes, L'\\');
        backslashes = 0;
        quoted += character;
    }

    quoted.append(backslashes * 2, L'\\');
    quoted += L'\"';
    return quoted;
}

HRESULT LaunchEditor(const std::vector<std::wstring>& paths)
{
    if (paths.empty())
    {
        return E_INVALIDARG;
    }

    const std::wstring executable = GetSiblingExecutablePath();
    if (executable.empty() || GetFileAttributesW(executable.c_str()) == INVALID_FILE_ATTRIBUTES)
    {
        return HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND);
    }

    std::wstring commandLine = QuoteArgument(executable);
    commandLine += L" --merge";
    for (const auto& path : paths)
    {
        commandLine += L' ';
        commandLine += QuoteArgument(path);
    }

    std::vector<wchar_t> mutableCommandLine(commandLine.begin(), commandLine.end());
    mutableCommandLine.push_back(L'\0');

    STARTUPINFOW startupInfo{};
    startupInfo.cb = sizeof(startupInfo);
    PROCESS_INFORMATION processInfo{};
    if (!CreateProcessW(
            executable.c_str(),
            mutableCommandLine.data(),
            nullptr,
            nullptr,
            FALSE,
            CREATE_UNICODE_ENVIRONMENT,
            nullptr,
            nullptr,
            &startupInfo,
            &processInfo))
    {
        return HRESULT_FROM_WIN32(GetLastError());
    }

    CloseHandle(processInfo.hThread);
    CloseHandle(processInfo.hProcess);
    return S_OK;
}

class ExplorerCommand final : public IExplorerCommand
{
public:
    ExplorerCommand()
    {
        ++moduleReferences;
    }

    ~ExplorerCommand()
    {
        --moduleReferences;
    }

    IFACEMETHODIMP QueryInterface(REFIID interfaceId, void** object) override
    {
        if (object == nullptr)
        {
            return E_POINTER;
        }

        *object = nullptr;
        if (IsEqualIID(interfaceId, IID_IUnknown) || IsEqualIID(interfaceId, IID_IExplorerCommand))
        {
            *object = static_cast<IExplorerCommand*>(this);
            AddRef();
            return S_OK;
        }

        return E_NOINTERFACE;
    }

    IFACEMETHODIMP_(ULONG) AddRef() override
    {
        return static_cast<ULONG>(InterlockedIncrement(&references_));
    }

    IFACEMETHODIMP_(ULONG) Release() override
    {
        const ULONG remaining = static_cast<ULONG>(InterlockedDecrement(&references_));
        if (remaining == 0)
        {
            delete this;
        }
        return remaining;
    }

    IFACEMETHODIMP GetTitle(IShellItemArray*, PWSTR* title) override
    {
        return CopyString(L"PDF 편집기로 합치기", title);
    }

    IFACEMETHODIMP GetIcon(IShellItemArray*, PWSTR* icon) override
    {
        const std::wstring executable = GetSiblingExecutablePath();
        return executable.empty() ? E_FAIL : CopyString(executable + L",0", icon);
    }

    IFACEMETHODIMP GetToolTip(IShellItemArray*, PWSTR* toolTip) override
    {
        return CopyString(
            L"선택한 PDF를 병합 목록에 추가합니다. 한 파일만 선택해도 사용할 수 있습니다.",
            toolTip);
    }

    IFACEMETHODIMP GetCanonicalName(GUID* commandName) override
    {
        if (commandName == nullptr)
        {
            return E_POINTER;
        }
        *commandName = MergeCommandClsid;
        return S_OK;
    }

    IFACEMETHODIMP GetState(IShellItemArray* selection, BOOL, EXPCMDSTATE* state) override
    {
        if (state == nullptr)
        {
            return E_POINTER;
        }
        *state = GetSelectedPdfPaths(selection).empty() ? ECS_DISABLED : ECS_ENABLED;
        return S_OK;
    }

    IFACEMETHODIMP Invoke(IShellItemArray* selection, IBindCtx*) override
    {
        return LaunchEditor(GetSelectedPdfPaths(selection));
    }

    IFACEMETHODIMP GetFlags(EXPCMDFLAGS* flags) override
    {
        if (flags == nullptr)
        {
            return E_POINTER;
        }
        *flags = ECF_DEFAULT;
        return S_OK;
    }

    IFACEMETHODIMP EnumSubCommands(IEnumExplorerCommand** commands) override
    {
        if (commands == nullptr)
        {
            return E_POINTER;
        }
        *commands = nullptr;
        return E_NOTIMPL;
    }

private:
    volatile long references_ = 1;
};

class CommandClassFactory final : public IClassFactory
{
public:
    CommandClassFactory()
    {
        ++moduleReferences;
    }

    ~CommandClassFactory()
    {
        --moduleReferences;
    }

    IFACEMETHODIMP QueryInterface(REFIID interfaceId, void** object) override
    {
        if (object == nullptr)
        {
            return E_POINTER;
        }

        *object = nullptr;
        if (IsEqualIID(interfaceId, IID_IUnknown) || IsEqualIID(interfaceId, IID_IClassFactory))
        {
            *object = static_cast<IClassFactory*>(this);
            AddRef();
            return S_OK;
        }
        return E_NOINTERFACE;
    }

    IFACEMETHODIMP_(ULONG) AddRef() override
    {
        return static_cast<ULONG>(InterlockedIncrement(&references_));
    }

    IFACEMETHODIMP_(ULONG) Release() override
    {
        const ULONG remaining = static_cast<ULONG>(InterlockedDecrement(&references_));
        if (remaining == 0)
        {
            delete this;
        }
        return remaining;
    }

    IFACEMETHODIMP CreateInstance(IUnknown* outer, REFIID interfaceId, void** object) override
    {
        if (outer != nullptr)
        {
            return CLASS_E_NOAGGREGATION;
        }

        auto* command = new (std::nothrow) ExplorerCommand();
        if (command == nullptr)
        {
            return E_OUTOFMEMORY;
        }

        const HRESULT result = command->QueryInterface(interfaceId, object);
        command->Release();
        return result;
    }

    IFACEMETHODIMP LockServer(BOOL lock) override
    {
        lock ? ++moduleReferences : --moduleReferences;
        return S_OK;
    }

private:
    volatile long references_ = 1;
};
}

BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, void*)
{
    if (reason == DLL_PROCESS_ATTACH)
    {
        moduleHandle = instance;
        DisableThreadLibraryCalls(instance);
    }
    return TRUE;
}

extern "C" HRESULT __stdcall DllGetClassObject(REFCLSID classId, REFIID interfaceId, void** object)
{
    if (!IsEqualCLSID(classId, MergeCommandClsid))
    {
        return CLASS_E_CLASSNOTAVAILABLE;
    }

    auto* factory = new (std::nothrow) CommandClassFactory();
    if (factory == nullptr)
    {
        return E_OUTOFMEMORY;
    }

    const HRESULT result = factory->QueryInterface(interfaceId, object);
    factory->Release();
    return result;
}

extern "C" HRESULT __stdcall DllCanUnloadNow()
{
    return moduleReferences == 0 ? S_OK : S_FALSE;
}
