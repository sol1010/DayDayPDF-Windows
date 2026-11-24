#include <windows.h>
#include <shobjidl_core.h>

#include <fcntl.h>
#include <io.h>
#include <iostream>

namespace
{
constexpr GUID MergeCommandClsid =
    {0xd1c90688, 0x87d6, 0x4494, {0x95, 0xf3, 0x2f, 0xba, 0x07, 0x3e, 0xc2, 0x77}};

bool CheckCommand(const GUID& classId, IShellItemArray* selection)
{
    IExplorerCommand* command = nullptr;
    HRESULT result = CoCreateInstance(
        classId,
        nullptr,
        CLSCTX_INPROC_SERVER | CLSCTX_LOCAL_SERVER,
        IID_PPV_ARGS(&command));
    if (FAILED(result))
    {
        std::wcout << L"COM activation failed: 0x" << std::hex << result << std::dec << L'\n';
        return false;
    }

    PWSTR title = nullptr;
    EXPCMDSTATE state = ECS_DISABLED;
    result = command->GetTitle(selection, &title);
    const HRESULT stateResult = command->GetState(selection, FALSE, &state);

    const bool success = SUCCEEDED(result) && SUCCEEDED(stateResult) && title != nullptr && state == ECS_ENABLED;
    std::wcout << (title == nullptr ? L"(제목 없음)" : title)
               << L" | state=" << static_cast<int>(state)
               << L" | " << (success ? L"OK" : L"FAILED") << L'\n';

    CoTaskMemFree(title);
    command->Release();
    return success;
}
}

int wmain(int argumentCount, wchar_t** arguments)
{
    _setmode(_fileno(stdout), _O_U16TEXT);
    if (argumentCount != 2)
    {
        std::wcout << L"사용법: ExplorerCommandSmoke.exe <PDF 경로>\n";
        return 2;
    }

    HRESULT result = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (FAILED(result))
    {
        std::wcout << L"COM initialization failed: 0x" << std::hex << result << L'\n';
        return 3;
    }

    IShellItem* item = nullptr;
    IShellItemArray* selection = nullptr;
    result = SHCreateItemFromParsingName(arguments[1], nullptr, IID_PPV_ARGS(&item));
    if (SUCCEEDED(result))
    {
        result = SHCreateShellItemArrayFromShellItem(item, IID_PPV_ARGS(&selection));
    }

    bool success = false;
    if (SUCCEEDED(result))
    {
        success = CheckCommand(MergeCommandClsid, selection);
    }
    else
    {
        std::wcout << L"PDF selection creation failed: 0x" << std::hex << result << L'\n';
    }

    if (selection != nullptr) selection->Release();
    if (item != nullptr) item->Release();
    CoUninitialize();
    return success ? 0 : 1;
}
